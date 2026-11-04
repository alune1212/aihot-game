// 官方物品目录的交易行均价。读者打开页面只读库。
// 2026-11-04 实测：图表 352143 / YWRywA 的 dfm/object.list 不登录就返回枪和配件的名称与 avgPrice。
// 价格为 0 的物品不上交易行，不写入。历史表只追加；最新价表里官方源盖过其他来源。
import type { Db } from "@aihot/backend/db";
import { sql } from "@aihot/backend/db";
import { guardedFetch } from "@aihot/backend/lib/http-fetch";
import { qqCookie, redactSecrets } from "./ams.ts";
import { postAms, type IdeFetch } from "./detail.ts";
import { formatGamePrice } from "./parse-yufan.ts";
import { recordFeedFailure, recordFeedSuccess } from "./store.ts";

/** 只要枪和配件。弹药、护甲、收集品不在这一轮。 */
export const PRICE_PRIMARIES = ["gun", "acc"] as const;
const OFFICIAL_SOURCE = "ams";
const FEED = { id: "ams-catalog", name: "官方交易行目录" };
const INSERT_CHUNK = 200;
const SOURCE_NAME = /^[a-z][a-z0-9-]{0,31}$/;

export interface CatalogItem {
  objectId: number;
  name: string;
  price: number;
}

export interface PricedPart {
  objectId: number | null;
  name: string | null;
  kind: "gun" | "attachment";
}

export interface PriceQuoteRow {
  objectId: number;
  name: string;
  price: number;
  source: string;
  fetchedAt: string;
}

export interface ResolvedPart {
  kind: "gun" | "attachment";
  objectId: number;
  name: string | null;
  price: number | null;
  source: string | null;
  matchedBy: "id" | "name" | null;
}

export interface CodeCost {
  total: number | null;
  known: number;
  expected: number;
  /** 0 到 100 的整数。没有可计价的部件时是 0。 */
  coverage: number;
  missing: string[];
  source: string | null;
  fetchedAt: string | null;
  parts: ResolvedPart[];
}

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.replace(/\s+/g, " ").trim();
  return name ? name.slice(0, 80) : null;
}

function whole(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  if (!Number.isSafeInteger(n)) return null;
  return n;
}

function positiveId(value: unknown): number | null {
  const n = whole(value);
  if (n === null || n <= 0) return null;
  return n;
}

/** 交易行现价。0 表示不能上架，超过 int4 的不收。 */
function marketPrice(value: unknown): number | null {
  const n = whole(value);
  if (n === null || n <= 0 || n > 2_147_483_647) return null;
  return n;
}

/** 名称对齐：全角、空白和零宽字符去掉后再比。 */
export function priceNameKey(name: string): string {
  return name.normalize("NFKC").replace(/[\s\u200b\u200c\u200d\ufeff]/g, "").toLowerCase();
}

/** 官方源优先。同一来源里，抓取时间更晚的优先。 */
export function preferQuote(current: PriceQuoteRow | undefined, incoming: PriceQuoteRow): PriceQuoteRow {
  if (!current) return incoming;
  const rank = (incoming.source === OFFICIAL_SOURCE ? 0 : 1) - (current.source === OFFICIAL_SOURCE ? 0 : 1);
  if (rank < 0) return incoming;
  if (rank > 0) return current;
  return incoming.fetchedAt > current.fetchedAt ? incoming : current;
}

/** 官方目录。结构不对返回 null，调用方不要把空数组当成「这一类没有物品」。 */
export function parseObjectList(data: unknown): CatalogItem[] | null {
  const root = record(record(record(data)?.data)?.data);
  if (!root || !Array.isArray(root.list)) return null;
  const byId = new Map<number, CatalogItem>();
  for (const entry of root.list) {
    const row = record(entry);
    const objectId = positiveId(row?.objectID);
    const name = text(row?.objectName);
    const price = marketPrice(row?.avgPrice);
    if (!objectId || !name || price === null) continue;
    byId.set(objectId, { objectId, name, price });
  }
  return [...byId.values()];
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * 追加一条价格历史，并刷新最新价。
 * 最新价里已经是官方源时，其他来源写不进去。
 */
export async function writePriceSnapshot(db: Db, items: readonly CatalogItem[], source: string, at: Date): Promise<number> {
  if (!SOURCE_NAME.test(source)) throw new Error("价格来源名称不合法");
  const rows = items.map((item) => ({
    object_id: item.objectId,
    item_name: item.name,
    price: item.price,
    source,
    fetched_at: at,
  }));
  for (const chunk of chunks(rows, INSERT_CHUNK)) {
    await db`
      INSERT INTO loadout_price_history ${db(chunk, "object_id", "item_name", "price", "source", "fetched_at")}
      ON CONFLICT (object_id, source, fetched_at) DO NOTHING`;
    await db`
      INSERT INTO loadout_item_prices ${db(chunk.map((row) => ({ object_id: row.object_id, price: row.price, source: row.source, priced_at: row.fetched_at })), "object_id", "price", "source", "priced_at")}
      ON CONFLICT (object_id) DO UPDATE SET
        price = EXCLUDED.price,
        source = EXCLUDED.source,
        priced_at = EXCLUDED.priced_at
      WHERE loadout_item_prices.source <> 'ams' OR EXCLUDED.source = 'ams'`;
  }
  return rows.length;
}

async function defaultFetch(url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
  const res = await guardedFetch(url, {
    method: init.method,
    headers: init.headers,
    body: init.body,
    route: "egress",
    timeoutMs: 25_000,
    maxBytes: 4_000_000,
  });
  return { status: res.status, text: () => res.text() };
}

/** 拉官方枪械和配件目录。失败时已写入的价格留着。 */
export async function syncMarketPrices(deps: { fetch?: IdeFetch; sleep?: (ms: number) => Promise<void>; env?: { DF_QQ_COOKIE?: string }; now?: () => Date } = {}): Promise<Record<string, unknown>> {
  const fetchPage = deps.fetch ?? defaultFetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const at = (deps.now ?? (() => new Date()))();
  const cookie = qqCookie(deps.env);
  const counts: Record<string, number> = {};
  let failure: string | null = null;
  for (const primary of PRICE_PRIMARIES) {
    const result = await postAms(fetchPage, sleep, "dfm/object.list", { primary, second: "", objectID: "" }, cookie);
    if (!result.ok) {
      failure = result.message;
      break;
    }
    const items = parseObjectList(result.data);
    if (!items) {
      failure = "官方物品目录的结构变了";
      break;
    }
    if (!items.length) {
      failure = `官方${primary === "gun" ? "枪械" : "配件"}目录是空的`;
      break;
    }
    counts[primary] = await writePriceSnapshot(sql, items, OFFICIAL_SOURCE, at);
  }
  const login = cookie ? "请求附带了 QQ 登录态" : "未配置 DF_QQ_COOKIE，按匿名请求";
  const summary = `枪 ${counts.gun ?? 0} 条，配件 ${counts.acc ?? 0} 条。${login}`.slice(0, 500);
  if (failure) {
    const message = redactSecrets(`${failure}。已写入的价格保留。${summary}`, cookie?.secrets ?? []);
    await recordFeedFailure(sql, FEED.id, FEED.name, message);
    return { ok: false, ...counts, error: message };
  }
  await recordFeedSuccess(sql, FEED.id, FEED.name, summary);
  return { ok: true, ...counts };
}

function quoteOf(row: PriceQuoteRow | undefined, part: PricedPart): ResolvedPart {
  const objectId = part.objectId ?? 0;
  if (!row) return { kind: part.kind, objectId, name: part.name, price: null, source: null, matchedBy: null };
  const byId = row.objectId === part.objectId;
  return { kind: part.kind, objectId: part.objectId ?? row.objectId, name: part.name ?? row.name, price: row.price, source: row.source, matchedBy: byId ? "id" : "name" };
}

/**
 * 单枪页上要不要标覆盖率。
 * 总价已经齐了就不再标；缺价时才标，避免一行上同时出现总价和「没齐」。
 */
export function partialCoverage(cost: CodeCost | undefined, total: number | null): number | null {
  if (!cost || total != null || cost.coverage <= 0 || cost.coverage >= 100) return null;
  return cost.coverage;
}

/** 一把枪的总成本。空槽不算。物品 id 对上优先，对不上再用配件名。 */
export function codeCost(parts: readonly PricedPart[], quotes: readonly PriceQuoteRow[]): CodeCost {
  const byId = new Map<number, PriceQuoteRow>();
  const byName = new Map<string, PriceQuoteRow>();
  for (const quote of quotes) {
    byId.set(quote.objectId, preferQuote(byId.get(quote.objectId), quote));
    const key = priceNameKey(quote.name);
    if (key) byName.set(key, preferQuote(byName.get(key), quote));
  }
  const installed = parts.filter((part) => part.objectId);
  const resolved: ResolvedPart[] = [];
  const missing: string[] = [];
  const sources = new Set<string>();
  let total = 0;
  let fetchedAt: string | null = null;
  for (const part of installed) {
    const named = part.name ? byName.get(priceNameKey(part.name)) : undefined;
    const quote = byId.get(part.objectId!) ?? named;
    const row = quoteOf(quote, part);
    resolved.push(row);
    if (!quote) {
      missing.push(part.name ?? String(part.objectId));
      continue;
    }
    total += quote.price;
    sources.add(quote.source);
    if (!fetchedAt || quote.fetchedAt > fetchedAt) fetchedAt = quote.fetchedAt;
  }
  const known = installed.length - missing.length;
  return {
    total: known ? total : null,
    known,
    expected: installed.length,
    coverage: installed.length ? Math.round((known / installed.length) * 100) : 0,
    missing,
    source: sources.size === 0 ? null : sources.size === 1 ? [...sources][0]! : "mixed",
    fetchedAt,
    parts: resolved,
  };
}

function partFrom(value: unknown, kind: PricedPart["kind"]): PricedPart | null {
  const row = record(value);
  if (!row) return null;
  return { objectId: positiveId(row.objectId), name: text(row.name), kind };
}

function partsFromPayload(payload: unknown): PricedPart[] {
  const row = record(payload);
  if (!row || row.source !== "ams") return [];
  const parts: PricedPart[] = [];
  const gun = partFrom(row.gun, "gun");
  if (gun?.objectId) parts.push(gun);
  if (!Array.isArray(row.slots)) return parts;
  for (const slot of row.slots) {
    const part = partFrom(slot, "attachment");
    if (part?.objectId) parts.push(part);
  }
  return parts;
}

interface HistoryRow {
  object_id: number;
  item_name: string;
  price: number;
  source: string;
  fetched_at: Date;
}

function toQuote(row: HistoryRow): PriceQuoteRow {
  return { objectId: Number(row.object_id), name: row.item_name, price: row.price, source: row.source, fetchedAt: row.fetched_at.toISOString() };
}

async function latestQuotes(db: Db, objectIds: number[], names: string[]): Promise<PriceQuoteRow[]> {
  const quotes: PriceQuoteRow[] = [];
  if (objectIds.length) {
    const rows = await db<HistoryRow[]>`
      SELECT DISTINCT ON (object_id) object_id, item_name, price, source, fetched_at
      FROM loadout_price_history
      WHERE object_id IN ${sql(objectIds)}
      ORDER BY object_id, (source = 'ams') DESC, fetched_at DESC`;
    quotes.push(...rows.map(toQuote));
  }
  if (names.length) {
    const rows = await db<HistoryRow[]>`
      SELECT DISTINCT ON (item_name) object_id, item_name, price, source, fetched_at
      FROM loadout_price_history
      WHERE item_name IN ${sql(names)}
      ORDER BY item_name, (source = 'ams') DESC, fetched_at DESC`;
    quotes.push(...rows.map(toQuote));
  }
  return quotes;
}

/** 若干条改枪码的成本。没有官方配件详情的码不出现在结果里。 */
export async function costsForLoadouts(db: Db, ids: readonly number[]): Promise<Map<number, CodeCost>> {
  const costs = new Map<number, CodeCost>();
  if (!ids.length) return costs;
  const details = await db<{ loadout_id: number; payload: unknown }[]>`
    SELECT loadout_id, payload FROM loadout_details WHERE source = 'ams' AND loadout_id IN ${sql([...ids])}`;
  const planned = new Map<number, PricedPart[]>();
  const objectIds = new Set<number>();
  for (const row of details) {
    const parts = partsFromPayload(row.payload);
    if (!parts.length) continue;
    planned.set(Number(row.loadout_id), parts);
    for (const part of parts) if (part.objectId) objectIds.add(part.objectId);
  }
  const idQuotes = await latestQuotes(db, [...objectIds], []);
  const knownIds = new Set(idQuotes.map((quote) => quote.objectId));
  const names = new Set<string>();
  for (const parts of planned.values()) {
    for (const part of parts) {
      if (!part.objectId || knownIds.has(part.objectId) || !part.name) continue;
      names.add(part.name);
      const key = priceNameKey(part.name);
      if (key) names.add(key);
    }
  }
  const nameQuotes = names.size ? await latestQuotes(db, [], [...names]) : [];
  const quotes = [...idQuotes, ...nameQuotes];
  for (const [id, parts] of planned) costs.set(id, codeCost(parts, quotes));
  return costs;
}

export interface LoadoutCostView extends CodeCost {
  id: number;
  weapon: string;
  code: string;
  totalText: string | null;
}

/** 一条改枪码的现价。码不存在返回 null。没有官方详情时覆盖率是 0。 */
export async function loadoutCost(db: Db, id: number): Promise<LoadoutCostView | null> {
  const [code] = await db<{ id: number; weapon: string; code: string }[]>`
    SELECT id, weapon, code FROM loadout_codes WHERE id = ${id}`;
  if (!code) return null;
  const cost = (await costsForLoadouts(db, [id])).get(id) ?? codeCost([], []);
  return { id: Number(code.id), weapon: code.weapon, code: code.code, totalText: formatGamePrice(cost.total), ...cost };
}
