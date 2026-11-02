// DFTTK 公开的理论击杀用时。只读战斗排名和物品中文名，不读 build / sharedBuild。
// 数字是社区模型按护甲、弹药和命中分布算出来的，不是官方实测。
import { matchWeapon } from "./catalog.ts";

export interface TtkRow {
  weapon: string;
  seconds: number;
  scenario: string;
  atMeters: number;
  version: string;
  preview: boolean;
}

export interface PatchRow {
  weapon: string;
  observedAt: string | null;
  version: string | null;
  lines: string[];
}

export interface DfttkPlan {
  baseUrl: string;
  itemsUrl: string;
  indexUrl: string;
  previewUrl: string | null;
}

const PATCH_LABEL: Record<string, string> = {
  baseDamage: "基础伤害",
  baseArmorDamage: "基础甲伤",
  attenuationDistancesCm: "衰减距离",
  attenuationRates: "衰减比例",
  fireRateRpm: "射速",
  displayFireRateRpm: "射速",
  muzzleVelocityMps: "初速",
};

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  return name || null;
}

export function absoluteDfttk(origin: string, path: string): string {
  return new URL(path, origin).toString();
}

/** manifest 里战斗数据的三个地址。排名文件还要再读索引才能确定。 */
export function parseDfttkPlan(body: string, origin: string): DfttkPlan {
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    throw new Error("DFTTK 清单不是 JSON");
  }
  const root = record(data);
  const files = record(root?.files);
  const entry = record(root?.entrypoints);
  const base = text(root?.resourceBaseUrl);
  const index = text(record(entry)?.firefightHomeRanking);
  if (!root || !files || !base || !index || !files["locales/zh-CN/items.json"] || !files[index]) {
    throw new Error("DFTTK 清单里没有理论 TTK 需要的文件");
  }
  const preview = text(root.previewUrl);
  const baseUrl = absoluteDfttk(origin, base.endsWith("/") ? base : `${base}/`);
  return {
    baseUrl,
    itemsUrl: absoluteDfttk(baseUrl, "locales/zh-CN/items.json"),
    indexUrl: absoluteDfttk(baseUrl, index),
    previewUrl: preview ? absoluteDfttk(origin, preview) : null,
  };
}

export function parseDfttkNames(body: string): Map<string, string> {
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    throw new Error("DFTTK 物品名不是 JSON");
  }
  const items = record(record(data)?.items);
  if (!items) throw new Error("DFTTK 物品名的结构变了");
  const names = new Map<string, string>();
  for (const [id, value] of Object.entries(items)) {
    if (typeof value === "string" && value.trim()) names.set(id, value.trim());
  }
  return names;
}

export function parseRankingIndex(body: string): { file: string; label: string } {
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    throw new Error("DFTTK 排名索引不是 JSON");
  }
  const root = record(data);
  const id = text(root?.defaultScenarioId);
  const scenarios = Array.isArray(root?.scenarios) ? root.scenarios : null;
  const chosen = scenarios?.map(record).find((row) => row && text(row.id) === id) ?? null;
  const file = text(chosen?.file);
  const label = text(chosen?.label);
  if (!file || !label) throw new Error("DFTTK 排名索引的结构变了");
  return { file, label };
}

function weaponOf(objectId: string, names: ReadonlyMap<string, string>, unmapped: string[]): string | null {
  const name = names.get(objectId);
  if (!name) {
    if (!unmapped.includes(objectId)) unmapped.push(objectId);
    return null;
  }
  const mapped = matchWeapon(name);
  if (!mapped) {
    if (!unmapped.includes(name)) unmapped.push(name);
    return null;
  }
  return mapped.weapon;
}

/** 折线在指定距离上的值。距离点是从近到远的台阶。 */
export function ttkAt(curve: readonly (readonly [number, number])[], meters: number): number | null {
  const points = curve.filter((point) => point.length >= 2 && Number.isFinite(point[0]) && Number.isFinite(point[1])).sort((a, b) => a[0] - b[0]);
  let value: number | null = null;
  for (const [distance, ttk] of points) {
    if (distance > meters) break;
    if (ttk <= 0 || ttk > 120) return null;
    value = ttk;
  }
  return value === null ? null : Math.round(value * 100) / 100;
}

export function parseDfttkRanking(body: string, names: ReadonlyMap<string, string>, scenario: string): { rows: TtkRow[]; unmapped: string[]; atMeters: number } {
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    throw new Error("DFTTK 排名不是 JSON");
  }
  const root = record(data);
  const metrics = root?.candidateMetrics;
  if (!root || !Array.isArray(metrics)) throw new Error("DFTTK 排名的结构变了");
  const version = text(root.dataVersion) ?? "";
  const range = record(record(root.ranking)?.distanceRange);
  const atMeters = typeof range?.defaultMin === "number" && range.defaultMin >= 0 ? range.defaultMin : 15;
  const unmapped: string[] = [];
  const rows: TtkRow[] = [];
  const seen = new Set<string>();
  for (const entry of metrics) {
    if (!Array.isArray(entry) || typeof entry[0] !== "string" || !Array.isArray(entry[1])) continue;
    const parts = entry[0].split(":");
    if (parts[1] !== "base" || !/^\d+$/.test(parts[0] ?? "")) continue;
    const weapon = weaponOf(parts[0]!, names, unmapped);
    if (!weapon || seen.has(weapon)) continue;
    const curve = entry[1].filter((point): point is [number, number] => Array.isArray(point) && point.length >= 2 && typeof point[0] === "number" && typeof point[1] === "number");
    const seconds = ttkAt(curve, atMeters);
    if (seconds === null) continue;
    seen.add(weapon);
    rows.push({ weapon, seconds, scenario, atMeters, version, preview: /preview/i.test(version) });
  }
  return { rows, unmapped, atMeters };
}

function showValue(key: string, value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (key === "attenuationDistancesCm") return `${Math.round(value / 100)}米`;
    const rounded = Math.round(value * 100) / 100;
    return String(rounded);
  }
  if (Array.isArray(value)) {
    const parts = value.map((item) => showValue(key, item)).filter(Boolean);
    return parts.join(" / ");
  }
  return "";
}

export function parseDfttkPreview(body: string, names: ReadonlyMap<string, string>): { rows: PatchRow[]; unmapped: string[] } {
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    throw new Error("DFTTK 体验服观察不是 JSON");
  }
  const root = record(data);
  const weapons = root?.weapons;
  if (!root || !Array.isArray(weapons)) throw new Error("DFTTK 体验服观察的结构变了");
  const version = text(root.version);
  const unmapped: string[] = [];
  const rows: PatchRow[] = [];
  for (const entry of weapons) {
    const row = record(entry);
    const objectId = text(row?.baseWeaponId);
    if (!row || !objectId) continue;
    const weapon = weaponOf(objectId, names, unmapped);
    if (!weapon) continue;
    const lines: string[] = [];
    const patches = Array.isArray(row.patches) ? row.patches : [];
    for (const patch of patches) {
      const item = record(patch);
      const path = text(item?.path) ?? "";
      const key = path.split(".").at(-1) ?? "";
      const label = PATCH_LABEL[key];
      if (!label || !item) continue;
      const before = showValue(key, item.before);
      const after = showValue(key, item.after);
      if (!before || !after || before === after) continue;
      lines.push(`${label} ${before} → ${after}`);
      if (lines.length >= 6) break;
    }
    if (!lines.length) continue;
    const observed = text(row.observedAt);
    rows.push({
      weapon,
      observedAt: observed && /^\d{4}-\d{2}-\d{2}$/.test(observed) ? observed : null,
      version,
      lines,
    });
  }
  return { rows, unmapped };
}
