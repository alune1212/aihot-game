// 有力气的官方热门不在 HTML 里，而在它前端用的 Supabase 公开表 official_gun_codes。
// 只收 source=official 且未下架的行。枪名对不上名录、模式不完整的，交给 decideLoadout 丢掉。
import { beijingDate } from "@aihot/contracts/time";
import type { RawLoadout } from "./codes.ts";

export interface YufanParse {
  raws: RawLoadout[];
  /** 接口返回的行数，含下架和非官方。到顶时用来判断还有没有下一页。 */
  rows: number;
}

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.replace(/\s+/g, " ").trim();
  return name || null;
}

/** 游戏币价格写成「60.8万」。0 和空当成没标。 */
export function formatGamePrice(value: unknown): string | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  if (!Number.isFinite(n) || n <= 0) return null;
  const rounded = Math.round(n);
  if (rounded < 10000) return String(rounded);
  const wan = rounded / 10000;
  const shown = wan >= 100 ? String(Math.round(wan)) : String(Math.round(wan * 10) / 10);
  return `${shown}万`;
}

function popularity(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  // shortcut: 超过 int4 就不当热度，这一行仍收录。现在最大约 86 万。
  if (!Number.isInteger(n) || n < 0 || n > 2_147_483_647) return null;
  return n;
}

/** synced_at 的北京时间日历日。无效或缺失就没有发布日，不按过季丢。 */
export function syncedOn(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return beijingDate(date);
}

export function parseYufan(body: string, sourceUrl: string): YufanParse {
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    throw new Error("有力气接口不是 JSON");
  }
  if (!Array.isArray(data)) throw new Error("有力气接口不是列表");
  const raws: RawLoadout[] = [];
  for (const item of data) {
    const row = record(item);
    if (!row) continue;
    if (row.is_hidden === true) continue;
    if (typeof row.source === "string" && row.source !== "official") continue;
    if (typeof row.solution_code !== "string" || !row.solution_code.trim()) continue;
    raws.push({
      code: row.solution_code,
      weaponHint: text(row.arms_name),
      author: text(row.author_nickname),
      priceText: formatGamePrice(row.price),
      postedOn: syncedOn(row.synced_at),
      sourceUrl,
      popularity: popularity(row.apply_num),
    });
  }
  return { raws, rows: data.length };
}
