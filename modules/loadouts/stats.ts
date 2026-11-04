// 配件热度只数有官方详情的方案。社区码对不上官方列表时没有槽位，不参与，也不拿它猜配件。
// 权重：没有应用次数记 1；有的话记 1 + log10(次数)。份额 = 这件配件的权重合计 / 这一组全部方案的权重合计。
// 大众配置：这个槽位至少 30% 的方案装了东西，而且第一名的份额不低于 25%。
import type { Db } from "@aihot/backend/db";
import { sql } from "@aihot/backend/db";
import { LOADOUT_MODES } from "./query.ts";
import { slotName } from "./slots.ts";

export const CONSENSUS_FILL = 0.3;
export const CONSENSUS_SHARE = 0.25;
/** 单个模式少过这么多条就不单独出一份，避免两三条被说成「这个模式的大众」。全部模式不受这条限制。 */
export const MODE_MIN_SAMPLE = 3;

const SLOT_ORDER = ["6", "2", "4", "37", "8", "1", "3", "38", "5", "11", "41", "14", "17", "22", "45", "31"];
const BANNED = "有力气";

export interface StatSlot {
  slotId: string;
  objectId: number;
  name: string;
  pic: string | null;
  grade: number | null;
}

export interface StatCode {
  weapon: string;
  mode: string | null;
  popularity: number | null;
  slots: StatSlot[];
}

export interface StoredStat {
  weapon: string;
  mode: string;
  slotId: string;
  objectId: number;
  name: string;
  pic: string | null;
  grade: number | null;
  uses: number;
  weight: number;
  share: number;
  filled: number;
  samples: number;
  computedAt: Date;
}

export interface AttachmentItem {
  objectId: number;
  name: string;
  pic: string | null;
  grade: number | null;
  uses: number;
  share: number;
}

export interface AttachmentSlotView {
  slotId: string;
  slotName: string;
  filled: number;
  items: AttachmentItem[];
}

export interface AttachmentGroup {
  mode: string;
  label: string;
  sample: number;
  slots: AttachmentSlotView[];
  consensus: Array<AttachmentItem & { slotId: string; slotName: string }>;
}

export interface AttachmentReport {
  computedAt: string;
  groups: AttachmentGroup[];
}

export function popularityWeight(popularity: number | null | undefined): number {
  if (popularity == null || !Number.isFinite(popularity) || popularity <= 0) return 1;
  return 1 + Math.log10(popularity);
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function readerName(value: string): string {
  const cleaned = value.split(BANNED).join("").trim();
  return cleaned || "未命名配件";
}

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

function slotRank(id: string): number {
  const index = SLOT_ORDER.indexOf(id);
  return index === -1 ? 1000 + (Number(id) || 0) : index;
}

export function aggregateStats(codes: readonly StatCode[], at: Date): StoredStat[] {
  interface ItemAcc { name: string; pic: string | null; grade: number | null; uses: number; weight: number }
  interface SlotAcc { slotName: string; filled: number; items: Map<number, ItemAcc> }
  interface GroupAcc { weight: number; samples: number; slots: Map<string, SlotAcc> }
  const byWeapon = new Map<string, Map<string, GroupAcc>>();

  const touch = (weapon: string, mode: string): GroupAcc => {
    let modes = byWeapon.get(weapon);
    if (!modes) byWeapon.set(weapon, modes = new Map());
    let group = modes.get(mode);
    if (!group) modes.set(mode, group = { weight: 0, samples: 0, slots: new Map() });
    return group;
  };

  for (const code of codes) {
    const weight = popularityWeight(code.popularity);
    const modes = [""];
    if (code.mode) modes.push(code.mode);
    for (const mode of modes) {
      const group = touch(code.weapon, mode);
      group.weight += weight;
      group.samples += 1;
      const seen = new Set<string>();
      for (const slot of code.slots) {
        if (seen.has(slot.slotId)) continue;
        seen.add(slot.slotId);
        let acc = group.slots.get(slot.slotId);
        if (!acc) group.slots.set(slot.slotId, acc = { slotName: slotName(slot.slotId), filled: 0, items: new Map() });
        acc.filled += 1;
        const item = acc.items.get(slot.objectId) ?? { name: slot.name, pic: slot.pic, grade: slot.grade, uses: 0, weight: 0 };
        item.uses += 1;
        item.weight += weight;
        if (!item.pic && slot.pic) item.pic = slot.pic;
        if (item.grade == null && slot.grade != null) item.grade = slot.grade;
        acc.items.set(slot.objectId, item);
      }
    }
  }

  const rows: StoredStat[] = [];
  for (const [weapon, modes] of byWeapon) {
    for (const [mode, group] of modes) {
      if (!group.samples || group.weight <= 0) continue;
      if (mode !== "" && group.samples < MODE_MIN_SAMPLE) continue;
      for (const [slotId, slot] of group.slots) {
        for (const [objectId, item] of slot.items) {
          rows.push({
            weapon,
            mode,
            slotId,
            objectId,
            name: item.name,
            pic: item.pic,
            grade: item.grade,
            uses: item.uses,
            weight: round4(item.weight),
            share: round4(item.weight / group.weight),
            filled: slot.filled,
            samples: group.samples,
            computedAt: at,
          });
        }
      }
    }
  }
  return rows;
}

export function presentWeaponStats(rows: readonly StoredStat[]): AttachmentReport | null {
  if (!rows.length) return null;
  const byMode = new Map<string, StoredStat[]>();
  for (const row of rows) {
    const list = byMode.get(row.mode) ?? [];
    list.push(row);
    byMode.set(row.mode, list);
  }
  const groups: AttachmentGroup[] = [];
  for (const [mode, list] of byMode) {
    const bySlot = new Map<string, StoredStat[]>();
    for (const row of list) {
      const slot = bySlot.get(row.slotId) ?? [];
      slot.push(row);
      bySlot.set(row.slotId, slot);
    }
    const sample = Math.max(...list.map((row) => row.samples));
    const slots: AttachmentSlotView[] = [];
    for (const [slotId, items] of bySlot) {
      const filled = Math.max(...items.map((row) => row.filled));
      const sorted = [...items].sort((a, b) => b.share - a.share || b.uses - a.uses || a.objectId - b.objectId);
      slots.push({
        slotId,
        slotName: slotName(slotId),
        filled,
        items: sorted.map((row) => ({
          objectId: row.objectId,
          name: readerName(row.name),
          pic: playerhubPic(row.pic),
          grade: row.grade,
          uses: row.uses,
          share: round4(row.share),
        })),
      });
    }
    const interesting = slots
      .filter((slot) => sample > 0 && slot.filled / sample >= CONSENSUS_FILL)
      .sort((a, b) => slotRank(a.slotId) - slotRank(b.slotId))
      .slice(0, 8);
    const shown = interesting.length
      ? interesting
      : [...slots].sort((a, b) => b.filled - a.filled || slotRank(a.slotId) - slotRank(b.slotId)).slice(0, 4);
    const consensus = shown.flatMap((slot) => {
      const top = slot.items[0];
      if (!top || sample <= 0 || slot.filled / sample < CONSENSUS_FILL || top.share < CONSENSUS_SHARE) return [];
      return [{ ...top, slotId: slot.slotId, slotName: slot.slotName }];
    });
    groups.push({
      mode,
      label: mode === "" ? "全部" : mode,
      sample,
      slots: shown.map((slot) => ({ ...slot, items: slot.items.slice(0, 4) })),
      consensus,
    });
  }
  groups.sort((a, b) => {
    if (a.mode === "") return -1;
    if (b.mode === "") return 1;
    const ai = LOADOUT_MODES.indexOf(a.mode as (typeof LOADOUT_MODES)[number]);
    const bi = LOADOUT_MODES.indexOf(b.mode as (typeof LOADOUT_MODES)[number]);
    return (ai === -1 ? 9 : ai) - (bi === -1 ? 9 : bi) || a.mode.localeCompare(b.mode, "zh");
  });
  const computedAt = rows.map((row) => row.computedAt).sort((a, b) => a.getTime() - b.getTime()).at(-1) ?? new Date();
  return { computedAt: computedAt.toISOString(), groups };
}

function slotsFromPayload(payload: unknown): StatSlot[] | null {
  if (!payload || typeof payload !== "object") return null;
  const row = payload as { source?: unknown; slots?: unknown };
  if (row.source !== "ams" || !Array.isArray(row.slots)) return null;
  const slots: StatSlot[] = [];
  const seen = new Set<string>();
  for (const item of row.slots) {
    if (!item || typeof item !== "object") continue;
    const slot = item as { slotId?: unknown; objectId?: unknown; name?: unknown; pic?: unknown; grade?: unknown };
    const slotId = typeof slot.slotId === "string" ? slot.slotId : "";
    const objectId = typeof slot.objectId === "number" && Number.isSafeInteger(slot.objectId) ? slot.objectId : 0;
    const name = typeof slot.name === "string" ? slot.name.trim() : "";
    if (!slotId || objectId <= 0 || !name || seen.has(slotId)) continue;
    seen.add(slotId);
    const grade = typeof slot.grade === "number" && Number.isInteger(slot.grade) && slot.grade >= 0 && slot.grade <= 6 ? slot.grade : null;
    slots.push({ slotId, objectId, name, pic: typeof slot.pic === "string" ? slot.pic : null, grade });
  }
  return slots;
}

const INSERT_COLUMNS = ["weapon", "mode", "slot_id", "object_id", "name", "pic", "grade", "uses", "weight", "share", "filled", "samples", "computed_at"] as const;

async function insertStats(db: Db, rows: readonly StoredStat[]): Promise<void> {
  for (let offset = 0; offset < rows.length; offset += 300) {
    const chunk = rows.slice(offset, offset + 300).map((row) => ({
      weapon: row.weapon,
      mode: row.mode,
      slot_id: row.slotId,
      object_id: row.objectId,
      name: row.name,
      pic: row.pic,
      grade: row.grade,
      uses: row.uses,
      weight: row.weight,
      share: row.share,
      filled: row.filled,
      samples: row.samples,
      computed_at: row.computedAt,
    }));
    await db`INSERT INTO loadout_attachment_stats ${db(chunk, ...INSERT_COLUMNS)}`;
  }
}

/** 按库里现有的官方详情整表重算。和抓取任务重算同一份数据，页面不在请求里算。 */
export async function recomputeAttachmentStats(): Promise<{ rows: number; weapons: number }> {
  const loaded = await sql<{ weapon: string; mode: string | null; popularity: number | null; payload: unknown }[]>`
    SELECT c.weapon, c.mode, c.popularity, d.payload
    FROM loadout_details d
    JOIN loadout_codes c ON c.id = d.loadout_id
    WHERE d.source = 'ams'`;
  const codes: StatCode[] = [];
  for (const row of loaded) {
    const slots = slotsFromPayload(row.payload);
    if (!slots) continue;
    codes.push({ weapon: row.weapon, mode: row.mode, popularity: row.popularity, slots });
  }
  const at = new Date();
  const rows = aggregateStats(codes, at);
  await sql.begin(async (tx) => {
    await tx`LOCK TABLE loadout_attachment_stats IN EXCLUSIVE MODE`;
    await tx`DELETE FROM loadout_attachment_stats`;
    await insertStats(tx, rows);
  });
  return { rows: rows.length, weapons: new Set(rows.map((row) => row.weapon)).size };
}

export async function weaponAttachmentStats(db: Db, weapon: string): Promise<AttachmentReport | null> {
  const loaded = await db<{
    mode: string; slot_id: string; object_id: number; name: string; pic: string | null; grade: number | null;
    uses: number; weight: number; share: number; filled: number; samples: number; computed_at: Date;
  }[]>`
    SELECT mode, slot_id, object_id, name, pic, grade, uses, weight, share, filled, samples, computed_at
    FROM loadout_attachment_stats WHERE weapon = ${weapon}`;
  return presentWeaponStats(loaded.map((row) => ({
    weapon,
    mode: row.mode,
    slotId: row.slot_id,
    objectId: Number(row.object_id),
    name: row.name,
    pic: row.pic,
    grade: row.grade,
    uses: row.uses,
    weight: row.weight,
    share: row.share,
    filled: row.filled,
    samples: row.samples,
    computedAt: row.computed_at,
  })));
}
