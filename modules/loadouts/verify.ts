// 每天对一遍改枪码：格式、枪名是否还对得上名录、在不在最近一次完整的官方列表里。
// 对不上的社区码标成 pending，页面写「待验证」。来源完整抓取后不再列出的，标成 removed；
// 过季的由清理任务删掉。拿不到可用的官方列表时不改已有状态（还没查过的记成 pending），
// 避免抓取失败、数据过期或没开 LOADOUT_AMS_ENABLED 时把「待验证」清成 ok。
import type { Db } from "@aihot/backend/db";
import { sql } from "@aihot/backend/db";
import { GAME_ID, matchWeapon } from "./catalog.ts";
import { decodeLoadoutCode } from "./decode.ts";
import { AMS_FEED_ID, OFFICIAL_FEED_ID } from "./feeds.ts";

const CN_CODE = /^(.+)-(烽火地带|全面战场|黑潮爆破)-([0-9A-Za-z]{12,})$/;

export type Verification = "ok" | "pending" | "removed";

export interface VerifyInput {
  code: string;
  weapon: string;
  hasDetail: boolean;
  officialListKnown: boolean;
  onOfficialList: boolean;
  feedSources: readonly { absent: boolean }[];
  /** 上一轮记下的状态。没有可用的官方列表时原样保留；还没有状态就是 null。 */
  previous: Verification | null;
}

export function codeMatchesWeapon(code: string, weapon: string): boolean {
  const match = CN_CODE.exec(code.replace(/\s+/g, ""));
  if (!match) return false;
  const mapped = matchWeapon(match[1]!);
  return mapped?.weapon === weapon;
}

/** 官方列表对得上就是 ok。社区码对不上官方列表，或格式、枪名对不上，标 pending。来源都撤了标 removed。 */
export function judgeVerification(input: VerifyInput): Verification {
  if (!input.officialListKnown) return input.previous ?? "pending";
  const shaped = codeMatchesWeapon(input.code, input.weapon);
  const hadFeed = input.feedSources.length > 0;
  const allAbsent = hadFeed && input.feedSources.every((source) => source.absent);
  if (input.officialListKnown && input.onOfficialList && shaped) return "ok";
  if (allAbsent && !(input.officialListKnown && input.onOfficialList)) return "removed";
  if (!shaped) return "pending";
  if (input.officialListKnown && !input.onOfficialList) return "pending";
  return "ok";
}

export interface VerifyReport {
  checked: number;
  pending: number;
  removed: number;
  ok: number;
  officialDetails: number;
  decoded: number;
  opaque: number;
  droppedYunmaku: number;
}

export async function verifyLoadouts(db: Db = sql): Promise<VerifyReport> {
  const dropped = await db<{ id: number }[]>`
    DELETE FROM loadout_codes c
    WHERE c.game_id = ${GAME_ID}
      AND c.source = 'yunmaku'
      AND c.author IS NULL
      AND NOT EXISTS (SELECT 1 FROM loadout_code_sources s WHERE s.loadout_id = c.id AND s.source <> 'yunmaku')
      AND NOT EXISTS (SELECT 1 FROM loadout_details d WHERE d.loadout_id = c.id)
    RETURNING c.id`;
  const rows = await db<{ id: number; code: string; weapon: string; has_detail: boolean; verification: Verification | null }[]>`
    SELECT c.id, c.code, c.weapon, c.verification, (d.loadout_id IS NOT NULL) AS has_detail
    FROM loadout_codes c
    LEFT JOIN loadout_details d ON d.loadout_id = c.id
    WHERE c.game_id = ${GAME_ID}`;
  const sourceRows = rows.length
    ? await db<{ loadout_id: number; source: string; absent_at: Date | null }[]>`
        SELECT loadout_id, source, absent_at FROM loadout_code_sources WHERE loadout_id IN ${db(rows.map((row) => row.id))}`
    : [];
  const [ams] = await db<{ health: string; last_error: string | null; last_ok_at: Date | null }[]>`
    SELECT health, last_error, last_ok_at FROM loadout_feeds WHERE id = ${AMS_FEED_ID}`;
  const officialListKnown = !!ams && ams.health === "ok" && !ams.last_error && !!ams.last_ok_at
    && ams.last_ok_at.getTime() >= Date.now() - 36 * 60 * 60 * 1000;
  const byId = new Map<number, { source: string; absent_at: Date | null }[]>();
  for (const row of sourceRows) {
    const list = byId.get(Number(row.loadout_id)) ?? [];
    list.push(row);
    byId.set(Number(row.loadout_id), list);
  }
  const report: VerifyReport = {
    checked: rows.length,
    pending: 0,
    removed: 0,
    ok: 0,
    officialDetails: 0,
    decoded: 0,
    opaque: 0,
    droppedYunmaku: dropped.length,
  };
  for (const row of rows) {
    const sources = byId.get(Number(row.id)) ?? [];
    const officialSources = sources.filter((source) => source.source === AMS_FEED_ID || source.source === OFFICIAL_FEED_ID);
    const onOfficialList = officialSources.some((source) => source.absent_at == null);
    const verification = judgeVerification({
      code: row.code,
      weapon: row.weapon,
      hasDetail: row.has_detail,
      officialListKnown,
      onOfficialList,
      feedSources: sources.map((source) => ({ absent: source.absent_at != null })),
      previous: row.verification,
    });
    const decoded = decodeLoadoutCode(row.code);
    const decodeStatus = row.has_detail ? "official" : decoded.ok ? "decoded" : "opaque";
    await db`UPDATE loadout_codes SET verification = ${verification}, decode_status = ${decodeStatus} WHERE id = ${row.id}`;
    report[verification] += 1;
    if (decodeStatus === "official") report.officialDetails += 1;
    else if (decodeStatus === "decoded") report.decoded += 1;
    else report.opaque += 1;
  }
  console.log(JSON.stringify({ level: "info", msg: "loadout verify", ...report, officialListKnown }));
  return report;
}
