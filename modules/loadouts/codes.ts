// 只收国服完整改枪码，并落到名录里的枪。码尾、国际服码、对不上的枪、有日期且早于赛季的，都不新收录。
import { matchWeapon } from "./catalog.ts";
import { SEASON_START } from "./feeds.ts";

export interface RawLoadout {
  code: string;
  weaponHint: string | null;
  author: string | null;
  priceText: string | null;
  /** 发布日，YYYY-MM-DD（北京时间）。没有就是 null，不按过季丢。 */
  postedOn: string | null;
  sourceUrl: string;
  /** 应用次数。没有就不参与热度排序。 */
  popularity?: number | null;
}

export interface FeedRow {
  categoryKey: string;
  weapon: string;
  code: string;
  mode: string;
  priceText: string | null;
  author: string | null;
  sourceUrl: string;
  postedOn: string | null;
  popularity: number | null;
}

export type Decision =
  | { ok: true; row: FeedRow }
  | { ok: false; reason: "shape" | "international" | "unmapped"; detail?: string }
  | { ok: false; reason: "stale"; row: FeedRow };

const CN_CODE = /^(.+)-(烽火地带|全面战场|黑潮爆破)-([0-9A-Za-z]{12,})$/;

export function cleanCode(value: string): string {
  return value.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/\s+/g, "");
}

function authorOf(value: string | null): string | null {
  const name = value?.replace(/\s+/g, " ").trim() ?? "";
  if (!name || name === "未标注") return null;
  return name.slice(0, 80);
}

function priceOf(value: string | null): string | null {
  const price = value?.replace(/\s+/g, " ").trim() ?? "";
  if (!price || price === "未标注") return null;
  return price.slice(0, 40);
}

/** 应用次数。不是 0 到 int4 的整数就当成没有，避免一行脏数据让整次写入失败。 */
export function popularityOf(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 2_147_483_647) return null;
  return value;
}

/** 页面上的应用次数。没有、或是 0，就不显示。 */
export function formatApplyCount(value: number | null | undefined): string | null {
  const count = popularityOf(value);
  if (count == null || count <= 0) return null;
  if (count < 10000) return `应用 ${count}`;
  const wan = Math.round(count / 1000) / 10;
  return `应用 ${wan}万`;
}

/** 一条原始记录收不收、收成哪把枪。 */
export function decideLoadout(raw: RawLoadout): Decision {
  const code = cleanCode(raw.code);
  if (!code) return { ok: false, reason: "shape" };
  // 国际服码即使套了国服模式名也不能收，国服改枪台导不进去。
  if (/operations|warfare/i.test(code)) return { ok: false, reason: "international" };
  const match = CN_CODE.exec(code);
  if (!match) return { ok: false, reason: "shape" };
  const mapped = matchWeapon(match[1]!) ?? (raw.weaponHint ? matchWeapon(raw.weaponHint) : null);
  if (!mapped) return { ok: false, reason: "unmapped", detail: (raw.weaponHint || match[1]!).slice(0, 80) };
  const postedOn = raw.postedOn && /^\d{4}-\d{2}-\d{2}$/.test(raw.postedOn) ? raw.postedOn : null;
  const row: FeedRow = {
    categoryKey: mapped.categoryKey,
    weapon: mapped.weapon,
    code,
    mode: match[2]!,
    priceText: priceOf(raw.priceText),
    author: authorOf(raw.author),
    sourceUrl: raw.sourceUrl,
    postedOn,
    popularity: popularityOf(raw.popularity),
  };
  if (postedOn && postedOn < SEASON_START) return { ok: false, reason: "stale", row };
  return { ok: true, row };
}

/** 同一条码在多页出现时，补上先出现的那条缺的作者、价格和日期。 */
export function mergeRaw(raws: readonly RawLoadout[]): RawLoadout[] {
  const map = new Map<string, RawLoadout>();
  for (const raw of raws) {
    const code = cleanCode(raw.code);
    if (!code) continue;
    const prev = map.get(code);
    if (!prev) {
      map.set(code, { ...raw, code });
      continue;
    }
    map.set(code, {
      code,
      weaponHint: prev.weaponHint ?? raw.weaponHint,
      author: prev.author ?? raw.author,
      priceText: prev.priceText ?? raw.priceText,
      postedOn: prev.postedOn ?? raw.postedOn,
      sourceUrl: prev.sourceUrl || raw.sourceUrl,
      popularity: prev.popularity ?? raw.popularity ?? null,
    });
  }
  return [...map.values()];
}
