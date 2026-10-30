// 方案详情和价格都在 worker 里同步，只认官方 AMS。读者打开页面只读库。
// 官方列表不能按分享码筛选（多传的字段会被忽略），所以按页把方案码对上库里的码。
// 这一轮失败时留下上次成功的官方缓存；从没对上过的码不写行，页面显示「暂无官方详情」。
import type { Db } from "@aihot/backend/db";
import { sql } from "@aihot/backend/db";
import { beijingDate } from "@aihot/contracts/time";
import { guardedFetch } from "@aihot/backend/lib/http-fetch";
import {
  AMS_URL,
  amsForm,
  codeKey,
  parseLatestPrices,
  parseSolutionPage,
  qqCookie,
  readAms,
  redactSecrets,
  type DetailSource,
  type LoadoutPayload,
  type LoadoutSlot,
} from "./ams.ts";
import { GAME_ID, matchWeapon, WEAPON_CATEGORIES } from "./catalog.ts";
import { isPreferredAuthor, OFFICIAL_FEED_ID, publicFeed, SEASON_START } from "./feeds.ts";
import { formatApplyCount } from "./codes.ts";
import { formatGamePrice } from "./parse-yufan.ts";
import { recordFeedFailure, recordFeedSuccess, type LoadoutCategoryView } from "./store.ts";

const GAP_MS = 1200;
const PAGE_SIZE = 20;
/** shortcut: 官方方案现在约 850 条、每页 20 条。超过 60 页就停，剩下的等下一轮。 */
const PAGE_CAP = 60;
const ATTEMPTS = 3;
const PRICE_BATCH = 40;

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

async function saveDetail(db: Db, loadoutId: number, payload: LoadoutPayload, at: Date): Promise<void> {
  const { prices: _prices, ...stored } = payload;
  await db`INSERT INTO loadout_details (loadout_id, source, gun_object_id, payload, synced_at)
    VALUES (${loadoutId}, ${payload.source}, ${payload.gun.objectId}, ${sql.json(JSON.parse(JSON.stringify(stored)))}, ${at})
    ON CONFLICT (loadout_id) DO UPDATE SET
      source = EXCLUDED.source,
      gun_object_id = EXCLUDED.gun_object_id,
      payload = EXCLUDED.payload,
      synced_at = EXCLUDED.synced_at`;
}

async function savePrices(db: Db, prices: Array<{ objectId: number; price: number }>, at: Date): Promise<void> {
  for (const row of prices) {
    await db`INSERT INTO loadout_item_prices (object_id, price, source, priced_at)
      VALUES (${row.objectId}, ${row.price}, 'ams', ${at})
      ON CONFLICT (object_id) DO UPDATE SET
        price = EXCLUDED.price,
        source = EXCLUDED.source,
        priced_at = EXCLUDED.priced_at`;
  }
}

/** 官方方案里的枪，按名录归到一把枪。对不上名录的不记，调用方不要猜。 */
async function rememberGun(code: string, payload: LoadoutPayload, at: Date): Promise<string | null> {
  const matched = matchWeapon(code) ?? (payload.gun.name ? matchWeapon(payload.gun.name) : null);
  if (!matched) return null;
  await sql`INSERT INTO loadout_guns (weapon, category_key, object_id, pic, grade, synced_at)
    VALUES (${matched.weapon}, ${matched.categoryKey}, ${payload.gun.objectId}, ${payload.gun.pic}, ${payload.gun.grade}, ${at})
    ON CONFLICT (weapon) DO UPDATE SET
      category_key = EXCLUDED.category_key,
      object_id = COALESCE(EXCLUDED.object_id, loadout_guns.object_id),
      pic = COALESCE(EXCLUDED.pic, loadout_guns.pic),
      grade = COALESCE(EXCLUDED.grade, loadout_guns.grade),
      synced_at = EXCLUDED.synced_at`;
  return matched.weapon;
}

/** 把库里每条改枪码对上官方方案，并按整份官方列表记下枪图。失败时不改已有的官方缓存。 */
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
  const guns = new Set<string>();
  let page = 1;
  let total = PAGE_SIZE;
  // 库里的码对上之后继续翻页：枪图要覆盖官方列表里的每一把枪，不能停在已收录的码上。
  while (page <= PAGE_CAP && (page - 1) * PAGE_SIZE < total) {
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
      const weapon = await rememberGun(item.code, item.payload, at);
      if (weapon) guns.add(weapon);
      const row = pending.get(codeKey(item.code));
      if (!row) continue;
      await saveDetail(sql, row.id, item.payload, at);
      await savePrices(sql, item.payload.prices, at);
      pending.delete(codeKey(item.code));
      matched += 1;
    }
    if (!parsed.items.length) break;
    page += 1;
  }
  if (!failure && pending.size && page > PAGE_CAP) failure = `官方方案超过 ${PAGE_CAP} 页，这一轮没翻完`;
  const login = cookie ? "请求附带了 QQ 登录态" : "未配置 DF_QQ_COOKIE，按匿名请求";
  const missing = pending.size ? `，${pending.size} 条不在官方列表里` : "";
  const summary = (rows.length
    ? `对上官方方案 ${matched} 条（${pages} 页）${missing}。记下 ${guns.size} 把枪的官方图。${login}`
    : `库里还没有改枪码。记下 ${guns.size} 把枪的官方图（${pages} 页）。${login}`).slice(0, 500);
  if (failure) {
    const message = redactSecrets(`${failure}。已有的官方详情保留。${summary}`, cookie?.secrets ?? []);
    await recordFeedFailure(sql, FEED_DETAIL.id, FEED_DETAIL.name, message);
    return { ok: false, matched, pages, guns: guns.size, missing: pending.size, error: message };
  }
  await recordFeedSuccess(sql, FEED_DETAIL.id, FEED_DETAIL.name, summary);
  return { ok: true, matched, pages, guns: guns.size, missing: pending.size };
}

function collectObjectIds(payload: LoadoutPayload): number[] {
  const ids = new Set<number>();
  if (payload.gun.objectId) ids.add(payload.gun.objectId);
  for (const slot of payload.slots) if (slot.objectId) ids.add(slot.objectId);
  return [...ids];
}

/** 按已缓存的官方方案刷新交易行最新价。失败时不改已有价格。 */
export async function syncLoadoutPrices(deps: { fetch?: IdeFetch; sleep?: (ms: number) => Promise<void>; env?: { DF_QQ_COOKIE?: string }; now?: () => Date } = {}): Promise<Record<string, unknown>> {
  const fetchPage = deps.fetch ?? defaultFetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const at = (deps.now ?? (() => new Date()))();
  const cookie = qqCookie(deps.env);
  const stored = await sql<{ payload: LoadoutPayload }[]>`SELECT payload FROM loadout_details WHERE source = 'ams'`;
  const ids = [...new Set(stored.flatMap((row) => collectObjectIds(row.payload)))];
  if (!ids.length) {
    await recordFeedSuccess(sql, FEED_PRICE.id, FEED_PRICE.name, "还没有需要刷新价格的物品");
    return { ok: true, items: 0 };
  }
  let priced = 0;
  let failure: string | null = null;
  for (let offset = 0; offset < ids.length && !failure; offset += PRICE_BATCH) {
    const batch = ids.slice(offset, offset + PRICE_BATCH);
    const result = await postAms(fetchPage, sleep, "dfm/object.price.latest", { objectID: batch }, cookie);
    if (!result.ok) {
      failure = result.message;
      break;
    }
    const prices = parseLatestPrices(result.data);
    await savePrices(sql, prices, at);
    priced += prices.length;
  }
  const login = cookie ? "请求附带了 QQ 登录态" : "未配置 DF_QQ_COOKIE，按匿名请求";
  if (failure) {
    const message = redactSecrets(`${failure}。已缓存的官方价格继续显示。本轮写上 ${priced} 条。${login}`, cookie?.secrets ?? []);
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
  slots: Array<LoadoutSlot & { price: number | null }>;
  prices: PriceSummary;
}

function asPayload(value: unknown): LoadoutPayload | null {
  const row = value && typeof value === "object" ? value as Partial<LoadoutPayload> : null;
  if (!row || row.source !== "ams" || !row.gun || !Array.isArray(row.slots)) return null;
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
    ...publicFeed(row.source, row.source_url),
    postedOn,
    popularityText: formatApplyCount(row.popularity),
    featured: isPreferredAuthor(row.author) && !stale,
    stale,
  };
}

const SIBLING_CAP = 40;
const RELATED_CAP = 6;

export interface LoadoutGunView {
  pic: string | null;
  grade: number | null;
  objectId: number | null;
}

export interface LoadoutSiblingView {
  id: number;
  name: string | null;
  mode: string | null;
  source: string | null;
  popularityText: string | null;
  featured: boolean;
  stale: boolean;
  hasDetail: boolean;
}

export interface LoadoutRelatedView {
  id: number;
  name: string | null;
  source: string | null;
  popularityText: string | null;
  totalText: string | null;
  pic: string | null;
}

function categoryLabelOf(key: string): string {
  return WEAPON_CATEGORIES.find((category) => category.key === key)?.label ?? key;
}

function rankCode(row: StoredCode): number {
  const postedOn = row.noted_at ? beijingDate(row.noted_at) : null;
  if (postedOn && postedOn < SEASON_START) return 3;
  if (row.source === OFFICIAL_FEED_ID) return 0;
  return isPreferredAuthor(row.author) ? 1 : 2;
}

export async function loadoutDetail(db: Db, id: number): Promise<{
  code: PublicLoadoutCode;
  categoryLabel: string;
  gun: LoadoutGunView;
  siblings: LoadoutSiblingView[];
  related: LoadoutRelatedView[];
  detail: LoadoutDetailView | null;
} | null> {
  const [code] = await db<StoredCode[]>`
    SELECT id, category_key, weapon, code, mode, price_text, author, popularity, source, source_url, noted_at
    FROM loadout_codes WHERE id = ${id}`;
  if (!code) return null;
  const shown = presentCode(code);
  const family = await db<StoredCode[]>`
    SELECT id, category_key, weapon, code, mode, price_text, author, popularity, source, source_url, noted_at
    FROM loadout_codes WHERE game_id = ${GAME_ID} AND weapon = ${code.weapon}`;
  const ranked = [...family].sort((a, b) => {
    const byRank = rankCode(a) - rankCode(b);
    if (byRank) return byRank;
    const byPop = (b.popularity ?? -1) - (a.popularity ?? -1);
    if (byPop) return byPop;
    return Number(b.id) - Number(a.id);
  });
  const kept = ranked.slice(0, SIBLING_CAP);
  if (!kept.some((row) => Number(row.id) === Number(code.id))) kept.push(code);
  const detailRows = family.length
    ? await db<{ loadout_id: number; payload: unknown }[]>`
        SELECT loadout_id, payload FROM loadout_details WHERE source = 'ams' AND loadout_id IN ${sql(family.map((row) => row.id))}`
    : [];
  const payloads = new Map<number, LoadoutPayload>();
  for (const row of detailRows) {
    const payload = asPayload(row.payload);
    if (payload) payloads.set(Number(row.loadout_id), payload);
  }
  const siblings: LoadoutSiblingView[] = kept.map((row) => {
    const view = presentCode(row);
    return {
      id: view.id,
      name: payloads.get(view.id)?.name ?? null,
      mode: view.mode,
      source: view.source,
      popularityText: view.popularityText,
      featured: view.featured,
      stale: view.stale,
      hasDetail: payloads.has(view.id),
    };
  });
  const relatedRows = ranked
    .filter((row) => Number(row.id) !== Number(code.id) && payloads.has(Number(row.id)))
    .sort((a, b) => (b.popularity ?? -1) - (a.popularity ?? -1) || Number(b.id) - Number(a.id))
    .slice(0, RELATED_CAP);
  const relatedIds = new Set<number>();
  for (const row of relatedRows) {
    const payload = payloads.get(Number(row.id));
    if (!payload) continue;
    for (const objectId of collectObjectIds(payload)) relatedIds.add(objectId);
  }
  const [own] = await db<{ source: DetailSource; payload: unknown; synced_at: Date }[]>`
    SELECT source, payload, synced_at FROM loadout_details WHERE loadout_id = ${id}`;
  const payload = own?.source === "ams" ? asPayload(own.payload) : null;
  const priceIds = new Set<number>(relatedIds);
  if (payload) for (const objectId of collectObjectIds(payload)) priceIds.add(objectId);
  const quotes = priceIds.size
    ? await db<{ object_id: number; price: number; priced_at: Date }[]>`
        SELECT object_id, price, priced_at FROM loadout_item_prices WHERE source = 'ams' AND object_id IN ${sql([...priceIds])}`
    : [];
  const prices = new Map(quotes.map((quote) => [Number(quote.object_id), { price: quote.price, at: quote.priced_at.toISOString() }]));
  const [mapped] = await db<{ object_id: string | number | null; pic: string | null; grade: number | null }[]>`
    SELECT object_id, pic, grade FROM loadout_guns WHERE weapon = ${code.weapon}`;
  const gun: LoadoutGunView = {
    pic: playerhubPic(mapped?.pic ?? null) ?? playerhubPic(payload?.gun.pic ?? null),
    grade: mapped ? asGrade(mapped.grade) : asGrade(payload?.gun.grade),
    objectId: asId(mapped?.object_id) ?? payload?.gun.objectId ?? null,
  };
  const related: LoadoutRelatedView[] = relatedRows.map((row) => {
    const view = presentCode(row);
    const item = payloads.get(view.id)!;
    const total = summarizePrices(item.gun.objectId, item.slots, prices).total;
    return {
      id: view.id,
      name: item.name,
      source: view.source,
      popularityText: view.popularityText,
      totalText: formatGamePrice(total),
      pic: playerhubPic(item.previewPic) ?? playerhubPic(item.gun.pic) ?? gun.pic,
    };
  });
  return {
    code: shown,
    categoryLabel: categoryLabelOf(code.category_key),
    gun,
    siblings,
    related,
    detail: payload && own ? {
      source: payload.source,
      sourceLabel: "官方改枪台",
      syncedAt: own.synced_at.toISOString(),
      name: payload.name,
      previewPic: playerhubPic(payload.previewPic),
      gun: { ...payload.gun, pic: playerhubPic(payload.gun.pic), grade: asGrade(payload.gun.grade) },
      properties: payload.properties,
      slots: payload.slots.map((slot) => ({ ...slot, pic: playerhubPic(slot.pic), price: slot.objectId ? prices.get(slot.objectId)?.price ?? null : null })),
      prices: summarizePrices(payload.gun.objectId, payload.slots, prices),
    } : null,
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

function playerhubPic(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.hostname !== "playerhub.df.qq.com") return null;
    return url;
  } catch {
    return null;
  }
}

function asId(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function asGrade(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isInteger(n) && n >= 0 && n <= 6 ? n : null;
}

/** 列表上补整枪总价、配件缩略图和官方枪图。价格还没齐的码留空，不拿方案标价冒充最新总价。 */
export async function priceLoadoutList(db: Db, categories: LoadoutCategoryView[]): Promise<LoadoutCategoryView[]> {
  const codes = categories.flatMap((category) => category.weapons.flatMap((weapon) => weapon.codes));
  const gunRows = await db<{ weapon: string; object_id: string | number | null; pic: string | null; grade: number | null }[]>`
    SELECT weapon, object_id, pic, grade FROM loadout_guns`;
  const gunByName = new Map(gunRows.map((row) => [row.weapon, row]));
  if (!codes.length) {
    return categories.map((category) => ({
      ...category,
      weapons: category.weapons.map((weapon) => decorateWeapon(weapon, gunByName, new Map())),
    }));
  }
  const ids = codes.map((code) => code.id);
  const details = await db<{ loadout_id: number; gun_object_id: number | null; payload: unknown }[]>`
    SELECT loadout_id, gun_object_id, payload FROM loadout_details WHERE source = 'ams' AND loadout_id IN ${sql(ids)}`;
  const objectIds = new Set<number>();
  const byLoadout = new Map<number, { name: string | null; gunObjectId: number | null; gunPic: string | null; gunGrade: number | null; slots: LoadoutSlot[] }>();
  for (const row of details) {
    const payload = asPayload(row.payload);
    if (!payload) continue;
    byLoadout.set(Number(row.loadout_id), {
      name: payload.name,
      gunObjectId: row.gun_object_id ? Number(row.gun_object_id) : payload.gun.objectId,
      gunPic: playerhubPic(payload.gun.pic),
      gunGrade: asGrade(payload.gun.grade),
      slots: payload.slots,
    });
    for (const id of collectObjectIds(payload)) objectIds.add(id);
  }
  const quotes = objectIds.size
    ? await db<{ object_id: number; price: number; priced_at: Date }[]>`
        SELECT object_id, price, priced_at FROM loadout_item_prices WHERE source = 'ams' AND object_id IN ${sql([...objectIds])}`
    : [];
  const prices = new Map(quotes.map((quote) => [Number(quote.object_id), { price: quote.price, at: quote.priced_at.toISOString() }]));
  return categories.map((category) => ({
    ...category,
    weapons: category.weapons.map((weapon) => {
      const shown = decorateWeapon(weapon, gunByName, byLoadout);
      return {
        ...shown,
        codes: weapon.codes.map((code) => {
          const detail = byLoadout.get(code.id);
          const parts = detail
            ? detail.slots.filter((slot) => slot.objectId).map((slot) => ({ name: slot.name, pic: playerhubPic(slot.pic), grade: asGrade(slot.grade) }))
            : [];
          const total = detail ? summarizePrices(detail.gunObjectId, detail.slots, prices).total : null;
          return { ...code, total, totalText: formatGamePrice(total), name: detail?.name ?? null, partCount: parts.length, parts };
        }),
      };
    }),
  }));
}

function decorateWeapon(
  weapon: LoadoutCategoryView["weapons"][number],
  gunByName: ReadonlyMap<string, { object_id: string | number | null; pic: string | null; grade: number | null }>,
  byLoadout: ReadonlyMap<number, { gunObjectId: number | null; gunPic: string | null; gunGrade: number | null }>,
): LoadoutCategoryView["weapons"][number] {
  const mapped = gunByName.get(weapon.name);
  let pic = playerhubPic(mapped?.pic ?? null);
  let grade = mapped ? asGrade(mapped.grade) : null;
  let objectId = mapped ? asId(mapped.object_id) : null;
  if (!pic) {
    for (const code of weapon.codes) {
      const detail = byLoadout.get(code.id);
      if (!detail?.gunPic) continue;
      pic = detail.gunPic;
      grade = grade ?? detail.gunGrade;
      objectId = objectId ?? detail.gunObjectId;
      break;
    }
  }
  return { ...weapon, pic, grade, objectId };
}
