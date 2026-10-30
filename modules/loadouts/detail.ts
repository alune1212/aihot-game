// 方案详情和交易行价格都在 worker 里同步。读者打开页面只读库，不打官方接口。
// 官方列表不能按分享码筛选（多传的字段会被忽略），所以按页把方案码对上库里的码。
// 登录失效或官方接口失败时，改用有力气的配件表和枪械基础属性，并记在信源健康里。
import type { Db } from "@aihot/backend/db";
import { sql } from "@aihot/backend/db";
import { beijingDate } from "@aihot/contracts/time";
import { guardedFetch } from "@aihot/backend/lib/http-fetch";
import { SITE } from "@aihot/site";
import {
  AMS_URL,
  amsForm,
  codeKey,
  parseLatestPrices,
  parseSolutionPage,
  parseYufanCodes,
  parseYufanItems,
  payloadFromFallback,
  qqCookie,
  readAms,
  redactSecrets,
  type DetailSource,
  type LoadoutPayload,
  type LoadoutSlot,
} from "./ams.ts";
import { FEED_LABEL, isPreferredAuthor, SEASON_START, YUFAN_API_ORIGIN, YUFAN_ORIGIN, YUFAN_PAGE, yufanApiHeaders } from "./feeds.ts";
import { formatApplyCount } from "./codes.ts";
import { formatGamePrice } from "./parse-yufan.ts";
import { mayFetch } from "./robots.ts";
import { recordFeedFailure, recordFeedSuccess, type LoadoutCategoryView } from "./store.ts";

const GAP_MS = 1200;
const PAGE_SIZE = 20;
/** shortcut: 官方方案现在约 850 条、每页 20 条。超过 60 页就停，剩下的改走公开表。 */
const PAGE_CAP = 60;
const ATTEMPTS = 3;
const PRICE_BATCH = 40;
const CODE_BATCH = 40;

const FEED_DETAIL = { id: "ams", name: "官方改枪台" };
const FEED_PRICE = { id: "ams-price", name: "官方交易行" };

export interface IdeResponse {
  status: number;
  text(): string;
}

export type IdeFetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<IdeResponse>;

export interface PriceQuote {
  price: number;
  at: string;
}

export interface PriceSummary {
  gun: number | null;
  parts: number | null;
  total: number | null;
  pricedAt: string | null;
  /** 枪身和每个已装配件都有价，总价才算完整。 */
  complete: boolean;
}

interface StoredDetail {
  source: DetailSource;
  payload: LoadoutPayload;
  syncedAt: Date;
}

async function defaultFetch(url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<IdeResponse> {
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

async function postAms(fetchPage: IdeFetch, sleep: (ms: number) => Promise<void>, method: string, param: unknown, cookie: { header: string; secrets: string[] } | null) {
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded", accept: "application/json" };
  if (cookie) headers.cookie = cookie.header;
  let last = readAms(0, "");
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    await sleep(GAP_MS);
    try {
      const res = await fetchPage(AMS_URL, { method: "POST", headers, body: amsForm(method, param) });
      last = readAms(res.status, res.text());
    } catch (error) {
      const message = redactSecrets(error instanceof Error ? error.message : String(error), cookie?.secrets ?? []);
      last = { ok: false, auth: false, retry: true, ret: null, message };
    }
    if (last.ok || last.auth || !last.retry || attempt === ATTEMPTS) return last;
  }
  return last;
}

async function allowYufan(fetchPage: IdeFetch, sleep: (ms: number) => Promise<void>): Promise<boolean> {
  await sleep(GAP_MS);
  const site = await fetchPage(new URL("/robots.txt", YUFAN_ORIGIN).toString());
  const siteBody = site.status === 200 || site.status === 404 ? site.text() : "";
  if (!mayFetch(site.status, siteBody, YUFAN_PAGE, SITE.crawlerName)) return false;
  await sleep(GAP_MS);
  const api = await fetchPage(new URL("/robots.txt", YUFAN_API_ORIGIN).toString());
  const apiBody = api.status === 200 || api.status === 404 ? api.text() : "";
  return mayFetch(api.status, apiBody, `${YUFAN_API_ORIGIN}/rest/v1/official_gun_codes`, SITE.crawlerName);
}

function yufanCodesUrl(codes: string[]): string {
  const url = new URL("/rest/v1/official_gun_codes", YUFAN_API_ORIGIN);
  const list = codes.map((code) => `"${code.replaceAll('"', "")}"`).join(",");
  url.searchParams.set("select", "solution_code,name,arms_id,arms_name,arms_pic,preview_pic,accessory");
  url.searchParams.set("solution_code", `in.(${list})`);
  return url.toString();
}

function yufanItemsUrl(ids: number[]): string {
  const url = new URL("/rest/v1/game_items", YUFAN_API_ORIGIN);
  url.searchParams.set("select", "object_id,object_name,pic,grade,avg_price");
  url.searchParams.set("object_id", `in.(${ids.join(",")})`);
  return url.toString();
}

async function saveDetail(db: Db, loadoutId: number, payload: LoadoutPayload, at: Date): Promise<"saved" | "kept"> {
  const [existing] = await db<{ source: string }[]>`SELECT source FROM loadout_details WHERE loadout_id = ${loadoutId}`;
  if (existing?.source === "ams" && payload.source !== "ams") return "kept";
  if (existing?.source === "yufan" && payload.source === "base") return "kept";
  const { prices: _prices, ...stored } = payload;
  await db`INSERT INTO loadout_details (loadout_id, source, gun_object_id, payload, synced_at)
    VALUES (${loadoutId}, ${payload.source}, ${payload.gun.objectId}, ${sql.json(JSON.parse(JSON.stringify(stored)))}, ${at})
    ON CONFLICT (loadout_id) DO UPDATE SET
      source = EXCLUDED.source,
      gun_object_id = EXCLUDED.gun_object_id,
      payload = EXCLUDED.payload,
      synced_at = EXCLUDED.synced_at`;
  return "saved";
}

async function savePrices(db: Db, prices: Array<{ objectId: number; price: number }>, source: "ams" | "yufan", at: Date): Promise<void> {
  for (const row of prices) {
    await db`INSERT INTO loadout_item_prices (object_id, price, source, priced_at)
      VALUES (${row.objectId}, ${row.price}, ${source}, ${at})
      ON CONFLICT (object_id) DO UPDATE SET
        price = EXCLUDED.price,
        source = EXCLUDED.source,
        priced_at = EXCLUDED.priced_at
      WHERE EXCLUDED.source = 'ams' OR loadout_item_prices.source <> 'ams'`;
  }
}

async function fillFromYufan(
  db: Db,
  fetchPage: IdeFetch,
  sleep: (ms: number) => Promise<void>,
  rows: Array<{ id: number; code: string; weapon: string }>,
  at: Date,
): Promise<{ saved: number; note: string }> {
  if (!rows.length) return { saved: 0, note: "" };
  if (!await allowYufan(fetchPage, sleep)) return { saved: 0, note: "有力气的 robots.txt 不允许抓取" };
  const headers = yufanApiHeaders();
  let saved = 0;
  for (let offset = 0; offset < rows.length; offset += CODE_BATCH) {
    const batch = rows.slice(offset, offset + CODE_BATCH);
    await sleep(GAP_MS);
    const res = await fetchPage(yufanCodesUrl(batch.map((row) => row.code)), { headers });
    if (res.status !== 200) throw new Error(`有力气方案 HTTP ${res.status}`);
    const found = parseYufanCodes(res.text());
    const byCode = new Map(found.map((row) => [codeKey(row.code), row]));
    const ids = new Set<number>();
    for (const row of found) {
      if (row.gun?.objectId) ids.add(row.gun.objectId);
      for (const part of row.parts) ids.add(part.objectId);
    }
    const items = new Map<number, ReturnType<typeof parseYufanItems>[number]>();
    const idList = [...ids];
    for (let itemOffset = 0; itemOffset < idList.length; itemOffset += PRICE_BATCH) {
      const slice = idList.slice(itemOffset, itemOffset + PRICE_BATCH);
      if (!slice.length) continue;
      await sleep(GAP_MS);
      const itemRes = await fetchPage(yufanItemsUrl(slice), { headers });
      if (itemRes.status !== 200) throw new Error(`有力气物品 HTTP ${itemRes.status}`);
      for (const item of parseYufanItems(itemRes.text())) items.set(item.objectId, item);
    }
    for (const row of batch) {
      const hit = byCode.get(codeKey(row.code));
      const gun = hit?.gun?.objectId ? items.get(hit.gun.objectId) ?? { ...hit.gun, price: null } : null;
      const payload = payloadFromFallback({
        source: hit ? "yufan" : "base",
        weapon: row.weapon,
        name: hit?.name ?? null,
        previewPic: hit?.previewPic ?? gun?.pic ?? null,
        gun,
        parts: hit?.parts ?? [],
        items,
      });
      if ((await saveDetail(db, row.id, payload, at)) === "saved") saved += 1;
      await savePrices(db, payload.prices, "yufan", at);
    }
  }
  return { saved, note: `有力气补了 ${saved} 条` };
}

/** 把库里每条改枪码对上官方方案；对不上或登录失效时改用公开表。 */
export async function syncLoadoutDetails(deps: { fetch?: IdeFetch; sleep?: (ms: number) => Promise<void>; env?: { DF_QQ_COOKIE?: string }; now?: () => Date } = {}): Promise<Record<string, unknown>> {
  const fetchPage = deps.fetch ?? defaultFetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const at = (deps.now ?? (() => new Date()))();
  const cookie = qqCookie(deps.env);
  const rows = await sql<{ id: number; code: string; weapon: string }[]>`
    SELECT id, code, weapon FROM loadout_codes ORDER BY id`;
  const pending = new Map<string, { id: number; code: string; weapon: string }>();
  for (const row of rows) pending.set(codeKey(row.code), row);
  let matched = 0;
  let pages = 0;
  let failure: string | null = null;
  if (pending.size) {
    let page = 1;
    let total = PAGE_SIZE;
    while (page <= PAGE_CAP && (page - 1) * PAGE_SIZE < total && pending.size) {
      const result = await postAms(fetchPage, sleep, "dfm/solution.arms.list", { page, limit: PAGE_SIZE, solutionType: "gun" }, cookie);
      pages += 1;
      if (!result.ok) {
        failure = result.message;
        break;
      }
      const parsed = parseSolutionPage(result.data);
      if (!parsed) {
        failure = "官方方案列表的结构变了";
        break;
      }
      total = parsed.total;
      for (const item of parsed.items) {
        const row = pending.get(codeKey(item.code));
        if (!row) continue;
        await saveDetail(sql, row.id, item.payload, at);
        await savePrices(sql, item.payload.prices, "ams", at);
        pending.delete(codeKey(item.code));
        matched += 1;
      }
      if (!parsed.items.length) break;
      page += 1;
    }
    if (!failure && pending.size && page > PAGE_CAP) failure = `官方方案超过 ${PAGE_CAP} 页，剩下的改用公开表`;
  }
  let fallback = { saved: 0, note: "" };
  try {
    if (pending.size) fallback = await fillFromYufan(sql, fetchPage, sleep, [...pending.values()], at);
  } catch (error) {
    const message = redactSecrets(error instanceof Error ? error.message : String(error), cookie?.secrets ?? []);
    failure = failure ? `${failure}；${message}` : message;
  }
  const login = cookie ? "已附带 QQ 登录态" : "未配置 DF_QQ_COOKIE";
  const summary = `对上官方方案 ${matched} 条（${pages} 页）。${login}。${fallback.note}`.replace(/\s+/g, " ").trim();
  if (failure) {
    const message = redactSecrets(`${failure}。${summary}`, cookie?.secrets ?? []);
    await recordFeedFailure(sql, FEED_DETAIL.id, FEED_DETAIL.name, message);
    return { ok: false, matched, pages, fallback: fallback.saved, error: message };
  }
  const note = pending.size && !rows.length ? "库里还没有改枪码" : summary;
  await recordFeedSuccess(sql, FEED_DETAIL.id, FEED_DETAIL.name, note.slice(0, 500));
  return { ok: true, matched, pages, fallback: fallback.saved };
}

function collectObjectIds(payload: LoadoutPayload): number[] {
  const ids = new Set<number>();
  if (payload.gun.objectId) ids.add(payload.gun.objectId);
  for (const slot of payload.slots) if (slot.objectId) ids.add(slot.objectId);
  return [...ids];
}

/** 按库里方案用到的物品，刷新交易行最新价。登录失效时改用有力气的均价。 */
export async function syncLoadoutPrices(deps: { fetch?: IdeFetch; sleep?: (ms: number) => Promise<void>; env?: { DF_QQ_COOKIE?: string }; now?: () => Date } = {}): Promise<Record<string, unknown>> {
  const fetchPage = deps.fetch ?? defaultFetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const at = (deps.now ?? (() => new Date()))();
  const cookie = qqCookie(deps.env);
  const stored = await sql<{ payload: LoadoutPayload }[]>`SELECT payload FROM loadout_details`;
  const ids = [...new Set(stored.flatMap((row) => collectObjectIds(row.payload)))];
  if (!ids.length) {
    await recordFeedSuccess(sql, FEED_PRICE.id, FEED_PRICE.name, "还没有需要刷新价格的物品");
    return { ok: true, items: 0 };
  }
  let priced = 0;
  let failure: string | null = null;
  const missed: number[] = [];
  for (let offset = 0; offset < ids.length && !failure; offset += PRICE_BATCH) {
    const batch = ids.slice(offset, offset + PRICE_BATCH);
    const result = await postAms(fetchPage, sleep, "dfm/object.price.latest", { objectID: batch }, cookie);
    if (!result.ok) {
      failure = result.message;
      missed.push(...ids.slice(offset));
      break;
    }
    const prices = parseLatestPrices(result.data);
    const got = new Set(prices.map((row) => row.objectId));
    await savePrices(sql, prices, "ams", at);
    priced += prices.length;
    missed.push(...batch.filter((id) => !got.has(id)));
  }
  if (failure && missed.length) {
    try {
      if (await allowYufan(fetchPage, sleep)) {
        const headers = yufanApiHeaders();
        for (let offset = 0; offset < missed.length; offset += PRICE_BATCH) {
          const batch = missed.slice(offset, offset + PRICE_BATCH);
          await sleep(GAP_MS);
          const res = await fetchPage(yufanItemsUrl(batch), { headers });
          if (res.status !== 200) throw new Error(`有力气物品 HTTP ${res.status}`);
          const prices = parseYufanItems(res.text()).flatMap((item) => item.price === null ? [] : [{ objectId: item.objectId, price: item.price }]);
          await savePrices(sql, prices, "yufan", at);
          priced += prices.length;
        }
      } else {
        failure = `${failure}；有力气的 robots.txt 不允许抓取`;
      }
    } catch (error) {
      const message = redactSecrets(error instanceof Error ? error.message : String(error), cookie?.secrets ?? []);
      failure = `${failure}；${message}`;
    }
  }
  const login = cookie ? "已附带 QQ 登录态" : "未配置 DF_QQ_COOKIE";
  if (failure) {
    const message = redactSecrets(`${failure}。已有价格 ${priced} 条。${login}`, cookie?.secrets ?? []);
    await recordFeedFailure(sql, FEED_PRICE.id, FEED_PRICE.name, message);
    return { ok: false, priced, error: message };
  }
  await recordFeedSuccess(sql, FEED_PRICE.id, FEED_PRICE.name, `刷新 ${priced} 个物品。${login}`.slice(0, 500));
  return { ok: true, priced };
}

export function summarizePrices(gunObjectId: number | null, slots: readonly LoadoutSlot[], prices: ReadonlyMap<number, PriceQuote>): PriceSummary {
  const gun = gunObjectId ? prices.get(gunObjectId) ?? null : null;
  const installed = slots.filter((slot) => slot.objectId);
  const partQuotes = installed.map((slot) => prices.get(slot.objectId!) ?? null);
  const known = partQuotes.filter((quote): quote is PriceQuote => !!quote);
  const parts = known.length ? known.reduce((sum, quote) => sum + quote.price, 0) : installed.length ? null : 0;
  const complete = !!gun && partQuotes.every((quote) => !!quote);
  const stamps = [gun?.at, ...known.map((quote) => quote.at)].filter((at): at is string => !!at);
  return {
    gun: gun?.price ?? null,
    parts,
    total: complete ? gun!.price + (parts ?? 0) : null,
    pricedAt: stamps.sort().at(-1) ?? null,
    complete,
  };
}

export interface LoadoutDetailView {
  source: DetailSource;
  sourceLabel: string;
  syncedAt: string;
  name: string | null;
  previewPic: string | null;
  gun: LoadoutPayload["gun"];
  properties: LoadoutPayload["properties"];
  attributeNote: string | null;
  slots: Array<LoadoutSlot & { price: number | null }>;
  prices: PriceSummary;
}

const SOURCE_LABEL: Record<DetailSource, string> = {
  ams: "官方改枪台",
  yufan: "有力气公开表",
  base: "武器基础属性",
};

function asPayload(value: unknown): LoadoutPayload | null {
  const row = value && typeof value === "object" ? value as Partial<LoadoutPayload> : null;
  if (!row || (row.source !== "ams" && row.source !== "yufan" && row.source !== "base") || !row.gun || !Array.isArray(row.slots)) return null;
  return row as LoadoutPayload;
}

export interface PublicLoadoutCode {
  id: number;
  weapon: string;
  categoryKey: string;
  code: string;
  mode: string | null;
  priceText: string | null;
  author: string | null;
  source: string | null;
  sourceUrl: string | null;
  postedOn: string | null;
  popularityText: string | null;
  featured: boolean;
  stale: boolean;
}

function presentCode(row: StoredCode): PublicLoadoutCode {
  const postedOn = row.noted_at ? beijingDate(row.noted_at) : null;
  const stale = !!postedOn && postedOn < SEASON_START;
  return {
    id: Number(row.id),
    weapon: row.weapon,
    categoryKey: row.category_key,
    code: row.code,
    mode: row.mode,
    priceText: row.price_text,
    author: row.author,
    source: row.source ? FEED_LABEL[row.source] ?? row.source : null,
    sourceUrl: row.source_url,
    postedOn,
    popularityText: formatApplyCount(row.popularity),
    featured: isPreferredAuthor(row.author) && !stale,
    stale,
  };
}

export async function loadoutDetail(db: Db, id: number): Promise<{ code: PublicLoadoutCode; detail: LoadoutDetailView | null } | null> {
  const [code] = await db<StoredCode[]>`
    SELECT id, category_key, weapon, code, mode, price_text, author, popularity, source, source_url, noted_at
    FROM loadout_codes WHERE id = ${id}`;
  if (!code) return null;
  const shown = presentCode(code);
  const [row] = await db<{ source: DetailSource; payload: unknown; synced_at: Date }[]>`
    SELECT source, payload, synced_at FROM loadout_details WHERE loadout_id = ${id}`;
  const payload = asPayload(row?.payload);
  if (!row || !payload) return { code: shown, detail: null };
  const ids = collectObjectIds(payload);
  const quotes = ids.length
    ? await db<{ object_id: number; price: number; priced_at: Date }[]>`
        SELECT object_id, price, priced_at FROM loadout_item_prices WHERE object_id IN ${sql(ids)}`
    : [];
  const prices = new Map(quotes.map((quote) => [Number(quote.object_id), { price: quote.price, at: quote.priced_at.toISOString() }]));
  return {
    code: shown,
    detail: {
      source: payload.source,
      sourceLabel: SOURCE_LABEL[payload.source],
      syncedAt: row.synced_at.toISOString(),
      name: payload.name,
      previewPic: payload.previewPic,
      gun: payload.gun,
      properties: payload.properties,
      attributeNote: payload.properties && payload.source !== "ams" ? "公开源只有原枪属性，没有改装前后的差值。" : null,
      slots: payload.slots.map((slot) => ({ ...slot, price: slot.objectId ? prices.get(slot.objectId)?.price ?? null : null })),
      prices: summarizePrices(payload.gun.objectId, payload.slots, prices),
    },
  };
}

interface StoredCode {
  id: number;
  category_key: string;
  weapon: string;
  code: string;
  mode: string | null;
  price_text: string | null;
  author: string | null;
  popularity: number | null;
  source: string | null;
  source_url: string | null;
  noted_at: Date | null;
}

export type { StoredCode };

/** 列表上补整枪总价。价格还没齐的码留空，不拿方案标价冒充最新总价。 */
export async function priceLoadoutList(db: Db, categories: LoadoutCategoryView[]): Promise<LoadoutCategoryView[]> {
  const codes = categories.flatMap((category) => category.weapons.flatMap((weapon) => weapon.codes));
  if (!codes.length) return categories;
  const ids = codes.map((code) => code.id);
  const details = await db<{ loadout_id: number; gun_object_id: number | null; payload: unknown }[]>`
    SELECT loadout_id, gun_object_id, payload FROM loadout_details WHERE loadout_id IN ${sql(ids)}`;
  const objectIds = new Set<number>();
  const byLoadout = new Map<number, { gunObjectId: number | null; slots: LoadoutSlot[] }>();
  for (const row of details) {
    const payload = asPayload(row.payload);
    if (!payload) continue;
    byLoadout.set(Number(row.loadout_id), { gunObjectId: row.gun_object_id ? Number(row.gun_object_id) : payload.gun.objectId, slots: payload.slots });
    for (const id of collectObjectIds(payload)) objectIds.add(id);
  }
  const quotes = objectIds.size
    ? await db<{ object_id: number; price: number; priced_at: Date }[]>`
        SELECT object_id, price, priced_at FROM loadout_item_prices WHERE object_id IN ${sql([...objectIds])}`
    : [];
  const prices = new Map(quotes.map((quote) => [Number(quote.object_id), { price: quote.price, at: quote.priced_at.toISOString() }]));
  return categories.map((category) => ({
    ...category,
    weapons: category.weapons.map((weapon) => ({
      ...weapon,
      codes: weapon.codes.map((code) => {
        const detail = byLoadout.get(code.id);
        const total = detail ? summarizePrices(detail.gunObjectId, detail.slots, prices).total : null;
        return { ...code, totalText: formatGamePrice(total) };
      }),
    })),
  }));
}
