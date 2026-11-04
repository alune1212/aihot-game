// 推荐打分是纯规则：只给已经在库里的改枪码排序，不生成新的码。
// 分数满分 100。选了偏好属性时：玩法 45、偏好 20、配件热度 20、梯队 10、理论 TTK 5。
// 没选偏好时，那 20 分并进玩法（65）。设了预算而且这条码有总价时，玩法让出 8 分给「越低于预算越高」。
// 缺热度、梯队或 TTK 时该项按 0.5 计，不奖也不罚。属性用改装后的官方数值（origin + change），再除以和页面属性条一样的刻度。

import { LOADOUT_MODES } from "./query.ts";

export const PLAYSTYLES = [
  { id: "rush", label: "近战冲锋", hint: "操控、腰射、射速" },
  { id: "range", label: "中远距离", hint: "射程、稳定、后坐" },
  { id: "hip", label: "腰射", hint: "腰际射击精度" },
  { id: "control", label: "控枪稳定", hint: "后坐和据枪" },
  { id: "balanced", label: "综合", hint: "各项拉平" },
] as const;

export type PlayStyle = (typeof PLAYSTYLES)[number]["id"];

export const STAT_FIELDS = [
  { key: "meatHarm", label: "基础伤害", scale: 100 },
  { key: "armorHarm", label: "对甲伤害", scale: 100 },
  { key: "shootDistance", label: "有效射程", scale: 100 },
  { key: "recoil", label: "后坐力控制", scale: 100 },
  { key: "control", label: "操控速度", scale: 100 },
  { key: "stable", label: "据枪稳定性", scale: 100 },
  { key: "hipShot", label: "腰际射击精度", scale: 100 },
  { key: "fireSpeed", label: "射速", scale: 1000 },
] as const;

export type StatKey = (typeof STAT_FIELDS)[number]["key"];
export type Stats = Record<StatKey, number>;

export const RECOMMEND_LIMIT = 8;

const STYLE_WEIGHTS: Record<PlayStyle, Partial<Record<StatKey, number>>> = {
  rush: { control: 0.28, hipShot: 0.22, fireSpeed: 0.22, recoil: 0.18, meatHarm: 0.1 },
  range: { shootDistance: 0.3, stable: 0.22, recoil: 0.2, meatHarm: 0.18, armorHarm: 0.1 },
  hip: { hipShot: 0.4, control: 0.25, fireSpeed: 0.2, recoil: 0.15 },
  control: { recoil: 0.4, stable: 0.35, control: 0.15, shootDistance: 0.1 },
  balanced: {
    meatHarm: 0.125, armorHarm: 0.125, shootDistance: 0.125, recoil: 0.125,
    control: 0.125, stable: 0.125, hipShot: 0.125, fireSpeed: 0.125,
  },
};

const TIER_SCORE: Record<string, number> = {
  "S+": 1, S: 0.86, "S-": 0.78,
  "A+": 0.8, A: 0.72, "A-": 0.64,
  "B+": 0.62, B: 0.55, "B-": 0.48,
  "C+": 0.42, C: 0.38, "C-": 0.32,
  "D+": 0.28, D: 0.22, "D-": 0.16,
};

export interface ScorePart {
  slotId: string;
  slotName: string;
  name: string;
  share: number;
}

export interface ScoreInput {
  id: number;
  /** 库里的原串。排序不会改它，也不会另造一串。 */
  code: string;
  weapon: string;
  categoryKey: string;
  mode: string | null;
  author: string | null;
  sources: Array<{ label: string; url: string | null }>;
  popularity: number | null;
  tier: string | null;
  ttkSeconds: number | null;
  ttkText: string | null;
  /**
   * 覆盖率 100 时的整枪总价。不满 100 或没有价格就是 null，预算不拿部分合计来比。
   * 数字从交易行最新价来；换算留在 budget-cost.ts，评分只看这个数。
   */
  cost: number | null;
  /** 0 到 100。没有查价时是 null。 */
  coverage: number | null;
  built: Stats | null;
  parts: ScorePart[];
  /** 这把枪已经有配件热度。没有时热度项按 0.5，不因为配件冷门扣分。 */
  popularityKnown: boolean;
}

export interface RecommendQuery {
  mode: (typeof LOADOUT_MODES)[number] | null;
  style: PlayStyle;
  stats: StatKey[];
  weapon: string | null;
  category: string | null;
  /** 游戏币。没填预算就是 null。 */
  budget: number | null;
  unknownWeapon: boolean;
}

export interface ScoreWeights {
  style: number;
  prefs: number;
  popular: number;
  tier: number;
  ttk: number;
  budget: number;
}

export function scoreWeights(hasPrefs: boolean, budgetOn: boolean): ScoreWeights {
  const prefs = hasPrefs ? 20 : 0;
  let style = hasPrefs ? 45 : 65;
  const budget = budgetOn ? 8 : 0;
  if (budgetOn) style -= 8;
  return { style, prefs, popular: 20, tier: 10, ttk: 5, budget };
}

export function styleLabel(style: PlayStyle): string {
  return PLAYSTYLES.find((item) => item.id === style)?.label ?? "综合";
}

export function statLabel(key: StatKey): string {
  return STAT_FIELDS.find((item) => item.key === key)?.label ?? key;
}

export function normStat(stats: Stats, key: StatKey): number {
  const scale = STAT_FIELDS.find((item) => item.key === key)?.scale ?? 100;
  const value = stats[key];
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value / scale));
}

export function styleScore(stats: Stats | null, style: PlayStyle): number {
  if (!stats) return 0.5;
  const weights = STYLE_WEIGHTS[style];
  let sum = 0;
  let total = 0;
  for (const key of Object.keys(weights) as StatKey[]) {
    const weight = weights[key] ?? 0;
    sum += weight * normStat(stats, key);
    total += weight;
  }
  return total ? sum / total : 0.5;
}

export function prefsScore(stats: Stats | null, prefs: readonly StatKey[]): number | null {
  if (!prefs.length) return null;
  if (!stats) return 0.5;
  return prefs.reduce((sum, key) => sum + normStat(stats, key), 0) / prefs.length;
}

export function popularScore(parts: readonly { share: number }[], known: boolean): number {
  if (!known || !parts.length) return 0.5;
  return parts.reduce((sum, part) => sum + Math.min(1, Math.max(0, part.share)), 0) / parts.length;
}

export function tierScore(tier: string | null): number {
  if (!tier) return 0.5;
  return TIER_SCORE[tier] ?? 0.5;
}

/** 1 是刚好花光预算，越便宜越接近 1。调用方已经滤掉超预算的。 */
export function budgetFit(cost: number, budget: number): number {
  if (budget <= 0) return cost <= 0 ? 1 : 0;
  return Math.min(1, Math.max(0, 1 - cost / budget));
}

export interface RankedLoadout extends ScoreInput {
  score: number;
  budgetApplied: boolean;
}

export interface RankResult {
  pricesAvailable: boolean;
  budgetApplied: boolean;
  matched: number;
  ranked: RankedLoadout[];
}

function focusKeys(style: PlayStyle, prefs: readonly StatKey[]): StatKey[] {
  if (prefs.length) return [...prefs];
  return Object.keys(STYLE_WEIGHTS[style]) as StatKey[];
}

export function rankLoadouts(inputs: readonly ScoreInput[], query: RecommendQuery): RankResult {
  if (query.unknownWeapon) return { pricesAvailable: false, budgetApplied: false, matched: 0, ranked: [] };
  const structural = inputs.filter((item) => {
    if (query.mode && item.mode !== query.mode) return false;
    if (query.weapon && item.weapon !== query.weapon) return false;
    if (!query.weapon && query.category && item.categoryKey !== query.category) return false;
    return true;
  });
  const pricesAvailable = structural.some((item) => item.cost != null && item.cost > 0);
  const budgetApplied = query.budget != null && pricesAvailable;
  const pool = budgetApplied
    ? structural.filter((item) => item.cost != null && item.cost <= query.budget!)
    : structural;
  const ttkValues = pool.map((item) => item.ttkSeconds).filter((value): value is number => value != null && value > 0 && value <= 120);
  const ttkMin = ttkValues.length ? Math.min(...ttkValues) : 0;
  const ttkMax = ttkValues.length ? Math.max(...ttkValues) : 0;
  const ttkComparable = ttkValues.length >= 2 && ttkMax > ttkMin;
  const weights = scoreWeights(query.stats.length > 0, budgetApplied);
  const ranked = pool.map((item) => {
    const style = styleScore(item.built, query.style);
    const prefs = prefsScore(item.built, query.stats);
    const popular = popularScore(item.parts, item.popularityKnown);
    const tier = tierScore(item.tier);
    const ttk = !ttkComparable || item.ttkSeconds == null || item.ttkSeconds <= 0
      ? 0.5
      : (ttkMax - item.ttkSeconds) / (ttkMax - ttkMin);
    const budget = budgetApplied && item.cost != null ? budgetFit(item.cost, query.budget!) : null;
    const raw = weights.style * style
      + weights.prefs * (prefs ?? 0)
      + weights.popular * popular
      + weights.tier * tier
      + weights.ttk * ttk
      + weights.budget * (budget ?? 0);
    const score = Math.round(Math.min(100, Math.max(0, raw)));
    return { ...item, score, budgetApplied };
  });
  ranked.sort((a, b) => b.score - a.score || (b.popularity ?? -1) - (a.popularity ?? -1) || a.id - b.id);
  return { pricesAvailable, budgetApplied, matched: ranked.length, ranked };
}

export interface ExplanationFacts {
  weapon: string;
  mode: string | null;
  styleLabel: string;
  tier: string | null;
  ttkText: string | null;
  costText: string | null;
  parts: Array<{ slot: string; name: string; sharePercent: number }>;
  strongest: { label: string; value: number } | null;
  weakest: { label: string; value: number } | null;
}

export function explanationFacts(item: RankedLoadout, style: PlayStyle, prefs: readonly StatKey[]): ExplanationFacts {
  const keys = item.built ? focusKeys(style, prefs) : [];
  const ordered = item.built
    ? [...keys].sort((a, b) => normStat(item.built!, b) - normStat(item.built!, a) || a.localeCompare(b))
    : [];
  const top = ordered[0];
  const low = ordered.length > 1 ? ordered[ordered.length - 1] : undefined;
  const parts = [...item.parts]
    .sort((a, b) => b.share - a.share || a.slotId.localeCompare(b.slotId))
    .slice(0, 3)
    .map((part) => ({ slot: part.slotName, name: part.name, sharePercent: Math.round(part.share * 100) }));
  return {
    weapon: item.weapon,
    mode: item.mode,
    styleLabel: styleLabel(style),
    tier: item.tier,
    ttkText: item.ttkText,
    costText: null,
    parts,
    strongest: item.built && top ? { label: statLabel(top), value: item.built[top] } : null,
    weakest: item.built && low && low !== top ? { label: statLabel(low), value: item.built[low] } : null,
  };
}

export function templateExplanation(facts: ExplanationFacts): { text: string; tradeoff: string } {
  const meta = [facts.mode, facts.tier ? `聪聪 ${facts.tier}` : null, facts.ttkText, facts.costText ? `整枪 ${facts.costText}` : null].filter(Boolean);
  const fit = facts.strongest
    ? `改装后${facts.strongest.label}是 ${facts.strongest.value}，比较贴近「${facts.styleLabel}」。`
    : "官方属性不齐，玩法匹配只作参考。";
  const part = facts.parts[0]
    ? `${facts.parts[0].slot}用了「${facts.parts[0].name}」，这把枪约 ${facts.parts[0].sharePercent}% 的官方方案也是这件。`
    : "这套配件还没有热度统计。";
  const text = `${facts.weapon}${meta.length ? `（${meta.join("，")}）` : ""}。${fit}${part}`;
  const tradeoff = facts.strongest && facts.weakest
    ? `${facts.strongest.label}较高，${facts.weakest.label}相对一般。`
    : "各项比较均衡。";
  return { text, tradeoff };
}

function wanParam(value: string | null): number | null {
  if (!value || !/^\d+(\.\d+)?$/.test(value)) return null;
  const wan = Number(value);
  if (!Number.isFinite(wan) || wan < 0 || wan > 100000) return null;
  return Math.round(wan * 10000);
}

/** 地址栏上的推荐条件。认不出的枪名留给调用方决定要不要空结果。 */
export function parseRecommendQuery(
  params: { get(name: string): string | null },
  known: { weapons: ReadonlySet<string>; categories: ReadonlySet<string> },
): RecommendQuery {
  const mode = params.get("mode");
  const style = params.get("style");
  const weapon = params.get("weapon")?.trim() || "";
  const category = params.get("category")?.trim() || "";
  const picked = new Set((params.get("stats") ?? "").split(",").map((item) => item.trim()).filter(Boolean));
  return {
    mode: LOADOUT_MODES.find((item) => item === mode) ?? null,
    style: PLAYSTYLES.find((item) => item.id === style)?.id ?? "balanced",
    stats: STAT_FIELDS.map((item) => item.key).filter((key) => picked.has(key)),
    weapon: weapon && known.weapons.has(weapon) ? weapon : null,
    category: category && known.categories.has(category) ? category : null,
    budget: wanParam(params.get("budget")),
    unknownWeapon: Boolean(weapon) && !known.weapons.has(weapon),
  };
}
