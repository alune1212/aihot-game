// 推荐只排序库里已有、并且有官方配件的改枪码。说明默认用模板。
// 模型改写要同时打开 MODEL_CALLS_ENABLED 和 LOADOUT_EXPLAIN_ENABLED，输出对不上传入的事实就丢掉，仍用模板。
import { z } from "zod";
import type { Db } from "@aihot/backend/db";
import { sql } from "@aihot/backend/db";
import { chatJson, MODELS } from "@aihot/backend/providers/llm";
import type { LoadoutProperties } from "./ams.ts";
import { presentBalance } from "./balance.ts";
import { GAME_ID, isWeaponListed, WEAPON_CATEGORIES } from "./catalog.ts";
import { formatApplyCount } from "./codes.ts";
import { loadBudgetCosts, type BudgetPart } from "./budget-cost.ts";
import { presentSources } from "./feeds.ts";
import { formatGamePrice } from "./parse-yufan.ts";
import {
  explanationFacts, parseRecommendQuery, rankLoadouts, RECOMMEND_LIMIT, styleLabel, templateExplanation,
  type ExplanationFacts, type PlayStyle, type RankedLoadout, type RecommendQuery, type ScoreInput, type ScorePart, type StatKey, type Stats, STAT_FIELDS,
} from "./recommend-rules.ts";
import { slotName } from "./slots.ts";

const BANNED = "有力气";

export const EXPLAIN_SYSTEM = `你替一个游戏改枪站写推荐说明。只根据用户给出的 JSON 写一句到两句中文，说明这套方案为什么贴近玩家选的玩法，并点出一个取舍。

规则：
- 只能使用 JSON 里出现过的枪名、模式、玩法、槽位、配件名、属性名、梯队、价格和数字。
- 不要编造改枪码，不要写出方案码。
- 不要提到 JSON 里没有的枪、配件或数字。
- 输出 JSON：{"text":"..."}`;

export function explainEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.MODEL_CALLS_ENABLED === "true" && env.LOADOUT_EXPLAIN_ENABLED === "true";
}

function readerText(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = value.split(BANNED).join("").replace(/\s+/g, " ").trim();
  return cleaned || null;
}

function knownTargets(now = new Date()): { weapons: Set<string>; categories: Set<string> } {
  const weapons = new Set<string>();
  const categories = new Set<string>();
  for (const category of WEAPON_CATEGORIES) {
    categories.add(category.key);
    for (const weapon of category.weapons) if (isWeaponListed(weapon, now)) weapons.add(weapon.name);
  }
  return { weapons, categories };
}

export function recommendQueryFrom(params: { get(name: string): string | null }, now = new Date()): RecommendQuery {
  return parseRecommendQuery(params, knownTargets(now));
}

const weaponNames = new Set(WEAPON_CATEGORIES.flatMap((category) => category.weapons.map((weapon) => weapon.name)));

function allowedNumbers(facts: ExplanationFacts): Set<string> {
  const found = new Set<string>();
  const walk = (value: unknown) => {
    if (typeof value === "number" && Number.isFinite(value)) {
      found.add(String(value));
      found.add(String(Math.round(value)));
      if (!Number.isInteger(value)) found.add(value.toFixed(1));
    } else if (typeof value === "string") {
      for (const match of value.matchAll(/\d+(?:\.\d+)?/g)) found.add(match[0]);
    } else if (Array.isArray(value)) {
      for (const item of value) walk(item);
    } else if (value && typeof value === "object") {
      for (const item of Object.values(value)) walk(item);
    }
  };
  walk(facts);
  return found;
}

/** 模型说明只能复述事实里有的枪、配件、数字。出现方案码或其他枪名就丢掉。 */
export function isGroundedExplanation(text: string, facts: ExplanationFacts): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 8 || trimmed.length > 400) return false;
  if (trimmed.includes(BANNED)) return false;
  if (/[A-Za-z0-9]{12,}/.test(trimmed)) return false;
  if (/-(烽火地带|全面战场|黑潮爆破)-/.test(trimmed)) return false;
  for (const name of weaponNames) {
    if (name !== facts.weapon && !facts.weapon.includes(name) && trimmed.includes(name)) return false;
  }
  const allowed = new Set<string>([
    facts.weapon,
    facts.styleLabel,
    facts.mode ?? "",
    ...facts.parts.flatMap((part) => [part.slot, part.name]),
    ...STAT_FIELDS.map((field) => field.label),
  ]);
  for (const match of trimmed.matchAll(/「([^」]+)」/g)) {
    if (!allowed.has(match[1] ?? "")) return false;
  }
  const numbers = allowedNumbers(facts);
  for (const match of trimmed.matchAll(/\d+(?:\.\d+)?/g)) {
    if (!numbers.has(match[0])) return false;
  }
  return true;
}

export async function polishExplanation(
  facts: ExplanationFacts,
  complete: (input: { system: string; user: string }) => Promise<string>,
): Promise<string | null> {
  try {
    const text = (await complete({ system: EXPLAIN_SYSTEM, user: JSON.stringify(facts) })).trim();
    return isGroundedExplanation(text, facts) ? text : null;
  } catch {
    return null;
  }
}

export async function polishWithSiteModel(facts: ExplanationFacts): Promise<string | null> {
  if (!explainEnabled()) return null;
  return polishExplanation(facts, async ({ system, user }) => {
    const chosen = process.env.LOADOUT_EXPLAIN_MODEL;
    const model = chosen && MODELS[chosen] ? chosen : "default";
    const res = await chatJson({
      model,
      purpose: "loadout_explain",
      subject: `loadout-explain:${facts.weapon}`,
      promptVersion: "loadout-explain-2026-11-04.1",
      system,
      user,
      schema: z.object({ text: z.string() }),
      temperature: 0,
      maxTokens: 512,
      timeoutMs: 20_000,
    });
    return res.data.text;
  });
}

export interface ExplainedLoadout extends RankedLoadout {
  explanation: string;
  tradeoff: string;
  explanationSource: "template" | "model";
}

export async function explainRanked(
  items: readonly RankedLoadout[],
  style: PlayStyle,
  prefs: readonly StatKey[],
  polish?: (facts: ExplanationFacts) => Promise<string | null>,
): Promise<ExplainedLoadout[]> {
  return Promise.all(items.map(async (item) => {
    const facts = explanationFacts(item, style, prefs);
    facts.costText = formatGamePrice(item.cost);
    const template = templateExplanation(facts);
    const polished = polish ? await polish(facts) : null;
    return {
      ...item,
      explanation: readerText(polished ?? template.text) ?? template.text,
      tradeoff: readerText(template.tradeoff) ?? template.tradeoff,
      explanationSource: polished ? "model" as const : "template" as const,
    };
  }));
}

interface RawSlot {
  slotId: string;
  slotName: string;
  objectId: number | null;
  name: string | null;
}

function parsedPayload(payload: unknown): { gunObjectId: number | null; properties: LoadoutProperties | null; slots: RawSlot[] } | null {
  if (!payload || typeof payload !== "object") return null;
  const row = payload as { source?: unknown; gun?: unknown; properties?: unknown; slots?: unknown };
  if (row.source !== "ams" || !row.gun || typeof row.gun !== "object" || !Array.isArray(row.slots)) return null;
  const gun = row.gun as { objectId?: unknown };
  const gunObjectId = typeof gun.objectId === "number" && gun.objectId > 0 ? gun.objectId : null;
  const properties = isProperties(row.properties) ? row.properties : null;
  const slots: RawSlot[] = [];
  for (const item of row.slots) {
    if (!item || typeof item !== "object") continue;
    const slot = item as { slotId?: unknown; slotName?: unknown; objectId?: unknown; name?: unknown };
    const slotId = typeof slot.slotId === "string" ? slot.slotId : "";
    if (!slotId) continue;
    const objectId = typeof slot.objectId === "number" && slot.objectId > 0 ? slot.objectId : null;
    const name = typeof slot.name === "string" && slot.name.trim() ? slot.name.trim() : null;
    slots.push({ slotId, slotName: typeof slot.slotName === "string" && slot.slotName.trim() ? slot.slotName.trim() : slotName(slotId), objectId, name });
  }
  return { gunObjectId, properties, slots };
}

function isProperties(value: unknown): value is LoadoutProperties {
  if (!value || typeof value !== "object") return false;
  const row = value as { origin?: unknown; change?: unknown };
  return isStats(row.origin);
}

function isStats(value: unknown): value is Stats {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return STAT_FIELDS.every((field) => typeof row[field.key] === "number" && Number.isFinite(row[field.key] as number));
}

function builtStats(properties: LoadoutProperties | null): Stats | null {
  if (!properties || !isStats(properties.origin)) return null;
  const change = properties.change && isStats(properties.change) ? properties.change : null;
  const stats = {} as Stats;
  for (const field of STAT_FIELDS) stats[field.key] = properties.origin[field.key] + (change?.[field.key] ?? 0);
  return stats;
}

function ttkSeconds(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  const seconds = (value as { seconds?: unknown }).seconds;
  return typeof seconds === "number" && seconds > 0 && seconds <= 120 ? seconds : null;
}

function categoryLabel(key: string): string {
  return WEAPON_CATEGORIES.find((category) => category.key === key)?.label ?? key;
}

export interface RecommendHit {
  id: number;
  code: string;
  weapon: string;
  categoryKey: string;
  categoryLabel: string;
  mode: string | null;
  author: string | null;
  sources: Array<{ label: string; url: string | null }>;
  popularityText: string | null;
  tier: string | null;
  ttkText: string | null;
  cost: number | null;
  costText: string | null;
  coverage: number | null;
  score: number;
  parts: Array<{ slotName: string; name: string; share: number }>;
  explanation: string;
  tradeoff: string;
  explanationSource: "template" | "model";
}

export interface RecommendResponse {
  pricesAvailable: boolean;
  budgetApplied: boolean;
  popularityReady: boolean;
  query: {
    mode: string | null;
    style: PlayStyle;
    styleLabel: string;
    stats: StatKey[];
    weapon: string | null;
    category: string | null;
    budgetWan: number | null;
  };
  matched: number;
  results: RecommendHit[];
  note: string;
}

function emptyResponse(query: RecommendQuery, note: string): RecommendResponse {
  return {
    pricesAvailable: false,
    budgetApplied: false,
    popularityReady: false,
    query: {
      mode: query.mode,
      style: query.style,
      styleLabel: styleLabel(query.style),
      stats: query.stats,
      weapon: query.weapon,
      category: query.category,
      budgetWan: query.budget == null ? null : query.budget / 10000,
    },
    matched: 0,
    results: [],
    note,
  };
}

export async function recommendLoadouts(db: Db, query: RecommendQuery, polish?: (facts: ExplanationFacts) => Promise<string | null>): Promise<RecommendResponse> {
  if (query.unknownWeapon) return emptyResponse(query, "没有这把枪。");
  const rows = await db<{
    id: number; code: string; weapon: string; category_key: string; mode: string | null; author: string | null;
    popularity: number | null; source: string | null; source_url: string | null; payload: unknown;
    tier: string | null; tier_as_of: string | null; ttk: unknown; patch: unknown;
  }[]>`
    SELECT c.id, c.code, c.weapon, c.category_key, c.mode, c.author, c.popularity, c.source, c.source_url, d.payload,
           b.tier, b.tier_as_of, b.ttk, b.patch
    FROM loadout_codes c
    JOIN loadout_details d ON d.loadout_id = c.id AND d.source = 'ams'
    LEFT JOIN loadout_weapon_balance b ON b.weapon = c.weapon
    WHERE c.game_id = ${GAME_ID}
    ${query.weapon ? db`AND c.weapon = ${query.weapon}` : db``}
    ${query.mode ? db`AND c.mode = ${query.mode}` : db``}
    ${!query.weapon && query.category ? db`AND c.category_key = ${query.category}` : db``}`;
  const parsed = rows.flatMap((row) => {
    const payload = parsedPayload(row.payload);
    return payload ? [{ row, payload }] : [];
  });
  const ids = parsed.map((item) => Number(item.row.id));
  const sourceRows = ids.length
    ? await db<{ loadout_id: number; source: string; source_url: string | null }[]>`
      SELECT loadout_id, source, source_url FROM loadout_code_sources WHERE loadout_id IN ${db(ids)}`
    : [];
  const sourcesById = new Map<number, Array<{ source: string; sourceUrl: string | null }>>();
  for (const source of sourceRows) {
    const list = sourcesById.get(Number(source.loadout_id)) ?? [];
    list.push({ source: source.source, sourceUrl: source.source_url });
    sourcesById.set(Number(source.loadout_id), list);
  }
  const pricedParts = new Map<number, BudgetPart[]>();
  for (const item of parsed) {
    const parts: BudgetPart[] = [];
    if (item.payload.gunObjectId) parts.push({ objectId: item.payload.gunObjectId, name: item.row.weapon });
    for (const slot of item.payload.slots) {
      if (slot.objectId) parts.push({ objectId: slot.objectId, name: slot.name });
    }
    pricedParts.set(Number(item.row.id), parts);
  }
  const costs = await loadBudgetCosts(db, pricedParts);
  const weapons = [...new Set(parsed.map((item) => item.row.weapon))];
  const statRows = weapons.length
    ? await db<{ weapon: string; mode: string; slot_id: string; object_id: number; share: number }[]>`
      SELECT weapon, mode, slot_id, object_id, share FROM loadout_attachment_stats WHERE weapon IN ${db(weapons)}`
    : [];
  const shareKey = (weapon: string, mode: string, slotId: string, objectId: number) => `${weapon}\t${mode}\t${slotId}\t${objectId}`;
  const shares = new Map<string, number>();
  const weaponsWithStats = new Set<string>();
  for (const stat of statRows) {
    weaponsWithStats.add(stat.weapon);
    shares.set(shareKey(stat.weapon, stat.mode, stat.slot_id, Number(stat.object_id)), stat.share);
  }
  const inputs: ScoreInput[] = parsed.map(({ row, payload }) => {
    const balance = presentBalance({ tier: row.tier, tier_as_of: row.tier_as_of, ttk: row.ttk, patch: row.patch });
    const known = weaponsWithStats.has(row.weapon);
    const parts: ScorePart[] = [];
    for (const slot of payload.slots) {
      if (!slot.objectId || !slot.name) continue;
      const specific = row.mode ? shares.get(shareKey(row.weapon, row.mode, slot.slotId, slot.objectId)) : undefined;
      const overall = shares.get(shareKey(row.weapon, "", slot.slotId, slot.objectId));
      parts.push({ slotId: slot.slotId, slotName: slot.slotName, name: readerText(slot.name) ?? "未命名配件", share: specific ?? overall ?? 0 });
    }
    const priced = costs.get(Number(row.id)) ?? { spendable: null, coverage: 0, missing: [] };
    const shown = presentSources(row.source, row.source_url, sourcesById.get(Number(row.id)) ?? []).flatMap((source) => {
      const label = readerText(source.label);
      return label ? [{ label, url: source.url }] : [];
    });
    return {
      id: Number(row.id),
      code: row.code,
      weapon: row.weapon,
      categoryKey: row.category_key,
      mode: row.mode,
      author: readerText(row.author),
      sources: shown,
      popularity: row.popularity,
      tier: balance.tier,
      ttkSeconds: ttkSeconds(row.ttk),
      ttkText: balance.ttkText,
      cost: priced.spendable,
      coverage: priced.coverage,
      built: builtStats(payload.properties),
      parts,
      popularityKnown: known,
    };
  });
  const popularityReady = inputs.some((item) => item.popularityKnown);
  const ranked = rankLoadouts(inputs, query);
  const top = ranked.ranked.slice(0, RECOMMEND_LIMIT);
  const explained = await explainRanked(top, query.style, query.stats, polish);
  const budgetIgnored = query.budget != null && !ranked.budgetApplied;
  const model = explained.some((item) => item.explanationSource === "model");
  const note = ranked.matched
    ? [
      `共 ${ranked.matched} 套符合，下面是前 ${explained.length} 套。`,
      "按玩法、配件热度、偏好属性、聪聪梯队和理论 TTK 给现成改枪码打分，不会新编一串码。",
      popularityReady ? "" : "配件热度还没算过，这一项先按中间计。",
      budgetIgnored ? "还没有覆盖完整的交易行总价，预算这次不筛。" : "",
      ranked.budgetApplied ? "已按预算去掉超支和价格没齐的方案。" : "",
      model ? "说明由模型按这些事实改写。" : "",
    ].join("")
    : "没有符合这些条件的现成改枪码。只从已经收录、并且有官方配件的方案里挑，不会新编一串码。";
  return {
    pricesAvailable: ranked.pricesAvailable,
    budgetApplied: ranked.budgetApplied,
    popularityReady,
    query: {
      mode: query.mode,
      style: query.style,
      styleLabel: styleLabel(query.style),
      stats: query.stats,
      weapon: query.weapon,
      category: query.category,
      budgetWan: query.budget == null ? null : query.budget / 10000,
    },
    matched: ranked.matched,
    results: explained.map((item) => ({
      id: item.id,
      code: item.code,
      weapon: item.weapon,
      categoryKey: item.categoryKey,
      categoryLabel: categoryLabel(item.categoryKey),
      mode: item.mode,
      author: item.author,
      sources: item.sources,
      popularityText: formatApplyCount(item.popularity),
      tier: item.tier,
      ttkText: item.ttkText,
      cost: item.cost,
      costText: formatGamePrice(item.cost),
      coverage: item.coverage,
      score: item.score,
      parts: item.parts.slice(0, 4).map((part) => ({ slotName: part.slotName, name: part.name, share: part.share })),
      explanation: item.explanation,
      tradeoff: item.tradeoff,
      explanationSource: item.explanationSource,
    })),
    note: readerText(note) ?? note,
  };
}

export async function recommendFromParams(params: { get(name: string): string | null }, db: Db = sql): Promise<RecommendResponse> {
  const query = recommendQueryFrom(params);
  const polish = explainEnabled() ? polishWithSiteModel : undefined;
  return recommendLoadouts(db, query, polish);
}
