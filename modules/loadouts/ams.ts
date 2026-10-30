// 官方改枪台走腾讯 AMS：POST https://comm.ams.game.qq.com/ide/
// 2026-10-30 实测：物品/方案图表是 352143 / YWRywA（coolxitech/deltaforce 同一套）。
// 旧文里的 316969 / NoOapI 不带有效登录会返回 ret 101。352143 目前匿名也能读到方案和交易行均价。
// 登录失效看 ret 101（未登录）和 ret 107（登录态无效）。这两种都不重试，改走公开表。
import { slotName } from "./slots.ts";
import { weaponBase, type GunBase } from "./weapon-base.ts";

export const AMS_URL = "https://comm.ams.game.qq.com/ide/";
export const AMS_CHART = "352143";
export const AMS_TOKEN = "YWRywA";

const AUTH_RETS = new Set([101, 107]);
const PIC_HOSTS = new Set(["playerhub.df.qq.com", "iugcmnqglxrcmdodugqk.supabase.co"]);
const STAT_KEYS = ["meatHarm", "shootDistance", "recoil", "control", "stable", "hipShot", "armorHarm", "fireSpeed"] as const;

export type StatKey = (typeof STAT_KEYS)[number];
export type Stats = Record<StatKey, number>;

export interface PartEffect {
  value: string;
  color: "green" | "red";
}

export interface LoadoutSlot {
  slotId: string;
  slotName: string;
  objectId: number | null;
  name: string | null;
  pic: string | null;
  grade: number | null;
  effects: PartEffect[];
}

export interface LoadoutGun {
  objectId: number | null;
  name: string;
  pic: string | null;
  grade: number | null;
}

export interface LoadoutProperties {
  origin: Stats;
  /** 官方方案才有。公开源没有改装差，这里是 null，页面不把原枪数值当成改装后。 */
  change: Stats | null;
  fireMode: string | null;
  muzzleVelocity: number | null;
  capacity: number | null;
}

export type DetailSource = "ams" | "yufan" | "base";

export interface LoadoutPayload {
  source: DetailSource;
  name: string | null;
  previewPic: string | null;
  gun: LoadoutGun;
  properties: LoadoutProperties | null;
  slots: LoadoutSlot[];
  /** 这轮从方案或物品表里带出来的价格，写入价格表，不放进展示用的总价。 */
  prices: Array<{ objectId: number; price: number }>;
}

export interface AmsOk {
  ok: true;
  data: unknown;
}
export interface AmsFail {
  ok: false;
  auth: boolean;
  retry: boolean;
  ret: number | null;
  message: string;
}
export type AmsRead = AmsOk | AmsFail;

export interface SolutionPage {
  page: number;
  total: number;
  items: Array<{ code: string; payload: LoadoutPayload }>;
}

const COOKIE_KEYS = ["openid", "access_token", "acctype", "appid"] as const;

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.replace(/\s+/g, " ").trim();
  return name || null;
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

function priceOf(value: unknown): number | null {
  const n = whole(value);
  if (n === null || n < 0) return null;
  return n;
}

/** 只留下 https 的官方图床和有力气图床，别的地址不进页面。 */
export function safePic(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || !PIC_HOSTS.has(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function statsOf(value: unknown): Stats | null {
  const row = record(value);
  if (!row) return null;
  const stats = {} as Stats;
  for (const key of STAT_KEYS) {
    const n = whole(row[key]);
    if (n === null) return null;
    stats[key] = n;
  }
  return stats;
}

function effectsOf(value: unknown): PartEffect[] {
  const groups = Array.isArray(value) ? value : [];
  const effects: PartEffect[] = [];
  for (const group of groups) {
    const list = record(group)?.effectList;
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const row = record(item);
      const label = text(row?.value);
      const color = row?.batteryColor === "green" || row?.batteryColor === "red" ? row.batteryColor : null;
      if (!label || !color) continue;
      effects.push({ value: label, color });
    }
  }
  return effects;
}

function effectIndex(value: unknown): Map<number, PartEffect[]> {
  const index = new Map<number, PartEffect[]>();
  if (!Array.isArray(value)) return index;
  for (const item of value) {
    const row = record(item);
    const objectId = positiveId(row?.objectID);
    if (!objectId) continue;
    index.set(objectId, effectsOf(row?.list));
  }
  return index;
}

function propertiesOf(item: Record<string, unknown>, gunDetail: Record<string, unknown> | null): LoadoutProperties | null {
  const detail = record(item.propertiesDetail);
  const origin = statsOf(detail?.origin);
  if (!origin) return null;
  return {
    origin,
    change: statsOf(detail?.change),
    fireMode: text(gunDetail?.fireMode),
    muzzleVelocity: whole(gunDetail?.muzzleVelocity),
    capacity: whole(gunDetail?.capacity),
  };
}

function baseProperties(base: GunBase): LoadoutProperties {
  return {
    origin: {
      meatHarm: base.meatHarm,
      shootDistance: base.shootDistance,
      recoil: base.recoil,
      control: base.control,
      stable: base.stable,
      hipShot: base.hipShot,
      armorHarm: base.armorHarm,
      fireSpeed: base.fireSpeed,
    },
    change: null,
    fireMode: base.fireMode,
    muzzleVelocity: base.muzzleVelocity,
    capacity: base.capacity,
  };
}

/** 从浏览器复制的 cookie 里只取登录要用的四项。缺 openid 或 access_token 就当没配。 */
export function qqCookie(env: { DF_QQ_COOKIE?: string } = process.env): { header: string; secrets: string[] } | null {
  const raw = env.DF_QQ_COOKIE?.trim();
  if (!raw) return null;
  const parts = new Map<string, string>();
  for (const piece of raw.split(";")) {
    const eq = piece.indexOf("=");
    if (eq <= 0) continue;
    const key = piece.slice(0, eq).trim().toLowerCase();
    const value = piece.slice(eq + 1).trim();
    if (!value || value.length > 512) continue;
    if (COOKIE_KEYS.includes(key as (typeof COOKIE_KEYS)[number])) parts.set(key, value);
  }
  const openid = parts.get("openid");
  const accessToken = parts.get("access_token");
  if (!openid || !accessToken) return null;
  parts.set("acctype", parts.get("acctype") === "wx" ? "wx" : "qc");
  if (!parts.get("appid")) parts.set("appid", "101491592");
  const header = COOKIE_KEYS.map((key) => `${key}=${parts.get(key)}`).join("; ");
  return { header, secrets: [openid, accessToken] };
}

/** 日志和健康状态里不能出现登录态。已知的密钥值整段换成 ***。 */
export function redactSecrets(value: string, secrets: readonly string[] = []): string {
  let out = value.replace(/(openid|access_token|appid)=([^;\s&]+)/gi, "$1=***");
  for (const secret of secrets) {
    if (secret.length >= 6) out = out.split(secret).join("***");
  }
  return out;
}

export function readAms(status: number, body: string): AmsRead {
  if (status === 429 || status === 503) return { ok: false, auth: false, retry: true, ret: null, message: `HTTP ${status}` };
  if (status !== 200) return { ok: false, auth: false, retry: status >= 500, ret: null, message: `HTTP ${status}` };
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return { ok: false, auth: false, retry: false, ret: null, message: "官方接口不是 JSON" };
  }
  const row = record(json);
  const ret = whole(row?.ret);
  if (ret === 0) return { ok: true, data: row?.jData };
  const auth = ret !== null && AUTH_RETS.has(ret);
  const retry = ret === -201;
  const msg = text(row?.sMsg)?.slice(0, 80) ?? "官方接口失败";
  return {
    ok: false,
    auth,
    retry,
    ret,
    message: auth ? `登录失效（ret ${ret}）` : `官方接口 ret ${ret ?? "?"}：${msg}`,
  };
}

export function amsForm(method: string, param: unknown): string {
  return new URLSearchParams({
    iChartId: AMS_CHART,
    iSubChartId: AMS_CHART,
    sIdeToken: AMS_TOKEN,
    source: "2",
    method,
    param: JSON.stringify(param),
  }).toString();
}

function itemObject(row: Record<string, unknown> | null, fallbackName: string | null): { name: string | null; pic: string | null; grade: number | null; price: number | null } {
  return {
    name: text(row?.objectName) ?? fallbackName,
    pic: safePic(row?.pic) ?? safePic(row?.prePic),
    grade: whole(row?.grade),
    price: priceOf(row?.avgPrice),
  };
}

/** 一页官方方案。solutionCode 之外的筛选目前会被接口忽略，所以调用方自己对码。 */
export function parseSolutionPage(data: unknown): SolutionPage | null {
  const root = record(record(record(data)?.data)?.data);
  if (!root || !Array.isArray(root.list)) return null;
  const relate = record(root.relateMap) ?? {};
  const items: SolutionPage["items"] = [];
  for (const entry of root.list) {
    const item = record(entry);
    const code = text(item?.solutionCode);
    if (!item || !code) continue;
    const payload = payloadFromSolution(item, relate);
    if (payload) items.push({ code, payload });
  }
  const page = whole(root.page) ?? 1;
  const total = whole(root.totalCount) ?? items.length;
  return { page, total, items };
}

function payloadFromSolution(item: Record<string, unknown>, relate: Record<string, unknown>): LoadoutPayload | null {
  const arms = record(item.armsDetail);
  const gunDetail = record(arms?.gunDetail);
  const gunId = positiveId(arms?.objectID);
  const gunMeta = itemObject(arms, text(arms?.objectName));
  const effects = effectIndex(item.accObjectEffect);
  const slots: LoadoutSlot[] = [];
  const prices: LoadoutPayload["prices"] = [];
  if (gunId && gunMeta.price) prices.push({ objectId: gunId, price: gunMeta.price });
  const rawSlots = Array.isArray(item.accessoryDetail) ? item.accessoryDetail : [];
  for (const entry of rawSlots) {
    const slot = record(entry);
    const slotId = text(slot?.slotID);
    if (!slot || !slotId || !/^\d+$/.test(slotId)) continue;
    const objectId = positiveId(slot.objectID);
    const meta = itemObject(objectId ? record(relate[String(objectId)]) : null, null);
    if (objectId && meta.price) prices.push({ objectId, price: meta.price });
    slots.push({
      slotId,
      slotName: slotName(slotId),
      objectId,
      name: objectId ? meta.name : null,
      pic: objectId ? meta.pic : null,
      grade: objectId ? meta.grade : null,
      effects: objectId ? effects.get(objectId) ?? [] : [],
    });
  }
  return {
    source: "ams",
    name: text(item.name),
    previewPic: safePic(item.previewPic) ?? safePic(item.prePreviewPic),
    gun: { objectId: gunId, name: gunMeta.name ?? "枪械", pic: gunMeta.pic, grade: gunMeta.grade },
    properties: propertiesOf(item, gunDetail),
    slots,
    prices,
  };
}

export interface FallbackPart {
  slotId: string;
  objectId: number;
}

export interface FallbackItem {
  objectId: number;
  name: string | null;
  pic: string | null;
  grade: number | null;
  price: number | null;
}

/** 有力气公开表只有槽位和物品，没有改装差。属性用枪名对上的基础表，对不上就空着。 */
export function payloadFromFallback(input: {
  source: "yufan" | "base";
  weapon: string;
  name: string | null;
  previewPic: string | null;
  gun: FallbackItem | null;
  parts: FallbackPart[];
  items: ReadonlyMap<number, FallbackItem>;
}): LoadoutPayload {
  const base = weaponBase(input.weapon);
  const prices: LoadoutPayload["prices"] = [];
  const slots: LoadoutSlot[] = input.parts.map((part) => {
    const item = input.items.get(part.objectId);
    if (item?.price) prices.push({ objectId: part.objectId, price: item.price });
    return {
      slotId: part.slotId,
      slotName: slotName(part.slotId),
      objectId: part.objectId,
      name: item?.name ?? null,
      pic: item?.pic ?? null,
      grade: item?.grade ?? null,
      effects: [],
    };
  });
  if (input.gun?.objectId && input.gun.price) prices.push({ objectId: input.gun.objectId, price: input.gun.price });
  return {
    source: input.source,
    name: input.name,
    previewPic: safePic(input.previewPic),
    gun: {
      objectId: input.gun?.objectId ?? null,
      name: input.gun?.name ?? input.weapon,
      pic: input.gun?.pic ?? null,
      grade: input.gun?.grade ?? null,
    },
    properties: base ? baseProperties(base) : null,
    slots,
    prices,
  };
}

export function parseYufanCodes(body: string): Array<{ code: string; name: string | null; previewPic: string | null; gun: FallbackItem | null; parts: FallbackPart[] }> {
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    throw new Error("有力气方案接口不是 JSON");
  }
  if (!Array.isArray(data)) throw new Error("有力气方案接口不是列表");
  const rows = [];
  for (const entry of data) {
    const row = record(entry);
    const code = text(row?.solution_code);
    if (!row || !code) continue;
    const parts: FallbackPart[] = [];
    if (Array.isArray(row.accessory)) {
      for (const item of row.accessory) {
        const slot = record(item);
        const slotId = text(slot?.slotID);
        const objectId = positiveId(slot?.objectID);
        if (!slotId || !objectId || !/^\d+$/.test(slotId)) continue;
        parts.push({ slotId, objectId });
      }
    }
    const gunId = positiveId(row.arms_id);
    rows.push({
      code,
      name: text(row.name),
      previewPic: safePic(row.preview_pic) ?? safePic(row.arms_pic),
      gun: gunId ? { objectId: gunId, name: text(row.arms_name), pic: safePic(row.arms_pic), grade: null, price: null } : null,
      parts,
    });
  }
  return rows;
}

export function parseYufanItems(body: string): FallbackItem[] {
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    throw new Error("有力气物品接口不是 JSON");
  }
  if (!Array.isArray(data)) throw new Error("有力气物品接口不是列表");
  const items: FallbackItem[] = [];
  for (const entry of data) {
    const row = record(entry);
    const objectId = positiveId(row?.object_id);
    if (!row || !objectId) continue;
    items.push({
      objectId,
      name: text(row.object_name),
      pic: safePic(row.pic),
      grade: whole(row.grade),
      price: priceOf(row.avg_price),
    });
  }
  return items;
}

/** 交易行最新价。dataMap 的键是物品 id，值里的 avgPrice 是当前均价。 */
export function parseLatestPrices(data: unknown): Array<{ objectId: number; price: number }> {
  const map = record(record(record(record(data)?.data)?.data)?.dataMap);
  if (!map) return [];
  const prices = [];
  for (const [key, value] of Object.entries(map)) {
    const objectId = positiveId(key);
    const price = priceOf(record(value)?.avgPrice);
    if (!objectId || price === null) continue;
    prices.push({ objectId, price });
  }
  return prices;
}

/** 对比和页面用：去掉空白再对码，官方码里偶发多一个空格。 */
export function codeKey(code: string): string {
  return code.normalize("NFKC").replace(/\s+/g, "");
}
