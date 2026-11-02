// 过季的改枪码直接删掉，连同来源和官方详情（外键级联）。
// 不删的情况：赛季没确认、这一轮有来源抓取失败、新赛季还没有够多的新码。
// 单轮还有上限。LOADOUT_CLEANUP_DRY_RUN=true 时只记会删哪些。
import type { Db } from "@aihot/backend/db";
import { sql } from "@aihot/backend/db";
import { beijingDate, beijingMidnight } from "@aihot/contracts/time";
import { GAME_ID } from "./catalog.ts";
import { AMS_FEED_ID, OFFICIAL_FEED_ID } from "./feeds.ts";
import { currentSeason } from "./season.ts";

export const CLEANUP_MAX_DEFAULT = 400;
export const CLEANUP_MIN_FRESH_DEFAULT = 40;
const RECENT_FAILURE_MS = 12 * 60 * 60 * 1000;

export interface CleanupCode {
  id: number;
  source: string | null;
  sources: string[];
  postedOn: string | null;
  fetchedOn: string | null;
  onOfficialList: boolean | null;
}

export interface CleanupPlan {
  ids: number[];
  bySource: Record<string, number>;
  skipped: string | null;
  capped: boolean;
  dryRun: boolean;
}

export function cleanupOptions(env: NodeJS.ProcessEnv = process.env): { dryRun: boolean; max: number; minFresh: number } {
  return {
    dryRun: env.LOADOUT_CLEANUP_DRY_RUN === "true",
    max: boundedInt(env.LOADOUT_CLEANUP_MAX, CLEANUP_MAX_DEFAULT),
    minFresh: boundedInt(env.LOADOUT_CLEANUP_MIN_FRESH, CLEANUP_MIN_FRESH_DEFAULT),
  };
}

function boundedInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 5000) return fallback;
  return parsed;
}

function isOfficial(code: CleanupCode): boolean {
  return [code.source, ...code.sources].some((source) => source === AMS_FEED_ID || source === OFFICIAL_FEED_ID);
}

/** 社区码看发布日。官方码只在确认不在当前官方列表、且这季还没再见到它时删。仍在官方列表上的留下。 */
export function outOfSeason(code: CleanupCode, seasonStart: string, listKnown: boolean): boolean {
  if (code.onOfficialList === true) return false;
  if (isOfficial(code)) {
    if (!listKnown || code.onOfficialList !== false) return false;
    if (code.fetchedOn && code.fetchedOn >= seasonStart) return false;
    return true;
  }
  return !!code.postedOn && code.postedOn < seasonStart;
}

export function planCleanup(input: {
  seasonCertain: boolean;
  seasonStart: string;
  fetchFailed: boolean;
  dryRun: boolean;
  max: number;
  minFresh: number;
  fresh: number;
  listKnown: boolean;
  codes: readonly CleanupCode[];
}): CleanupPlan {
  const empty = { ids: [], bySource: {}, capped: false, dryRun: input.dryRun };
  if (!input.seasonCertain) return { ...empty, skipped: "赛季没有确认，不删" };
  if (input.fetchFailed) return { ...empty, skipped: "这一轮有来源抓取失败，不删" };
  if (input.fresh < input.minFresh) return { ...empty, skipped: `新赛季只有 ${input.fresh} 条码，少于 ${input.minFresh}，不删` };
  const matches = input.codes.filter((code) => outOfSeason(code, input.seasonStart, input.listKnown));
  matches.sort((a, b) => a.id - b.id);
  const capped = matches.length > input.max;
  const chosen = matches.slice(0, input.max);
  const bySource: Record<string, number> = {};
  for (const code of chosen) {
    const names = code.sources.length ? code.sources : [code.source ?? "article"];
    for (const name of new Set(names)) bySource[name] = (bySource[name] ?? 0) + 1;
  }
  return { ids: chosen.map((code) => code.id), bySource, skipped: null, capped, dryRun: input.dryRun };
}

interface FeedHealth {
  id: string;
  health: string;
  last_fetch_at: Date | null;
  last_ok_at: Date | null;
  last_error: string | null;
}

/** 最近 12 小时里有聚合站抓取失败，就整轮不删。更早的失败不算这一轮。 */
export function recentFetchFailed(feeds: readonly FeedHealth[], now = new Date()): boolean {
  const cutoff = now.getTime() - RECENT_FAILURE_MS;
  return feeds.some((feed) => {
    if (!feed.last_fetch_at || feed.last_fetch_at.getTime() < cutoff) return false;
    return feed.health !== "ok" || !!feed.last_error;
  });
}

function onOfficialList(rows: readonly { source: string; absent_at: Date | null }[]): boolean | null {
  const official = rows.filter((row) => row.source === AMS_FEED_ID || row.source === OFFICIAL_FEED_ID);
  if (!official.length) return null;
  return official.some((row) => row.absent_at == null);
}

export async function cleanupOutOfSeason(deps: { db?: Db; now?: Date; env?: NodeJS.ProcessEnv; listKnown?: boolean } = {}): Promise<CleanupPlan & { deleted: number }> {
  const db = deps.db ?? sql;
  const now = deps.now ?? new Date();
  const today = beijingDate(now);
  const options = cleanupOptions(deps.env ?? process.env);
  const season = await currentSeason(db, today);
  const feeds = await db<FeedHealth[]>`SELECT id, health, last_fetch_at, last_ok_at, last_error FROM loadout_feeds`;
  const fetchFailed = recentFetchFailed(feeds, now);
  const officialKnown = deps.listKnown ?? (!fetchFailed && feeds.some((feed) => {
    if (feed.id !== AMS_FEED_ID && feed.id !== OFFICIAL_FEED_ID) return false;
    if (feed.health !== "ok" || feed.last_error) return false;
    return (feed.last_ok_at?.getTime() ?? 0) >= now.getTime() - RECENT_FAILURE_MS;
  }));
  const start = beijingMidnight(season.startsOn);
  const [freshRow] = await db<{ n: number }[]>`
    SELECT count(*)::int AS n FROM loadout_codes
    WHERE game_id = ${GAME_ID} AND noted_at >= ${start}`;
  const rows = await db<{ id: number; source: string | null; noted_at: Date | null; fetched_at: Date | null }[]>`
    SELECT id, source, noted_at, fetched_at FROM loadout_codes WHERE game_id = ${GAME_ID}`;
  const sourceRows = rows.length
    ? await db<{ loadout_id: number; source: string; absent_at: Date | null }[]>`
        SELECT loadout_id, source, absent_at FROM loadout_code_sources WHERE loadout_id IN ${db(rows.map((row) => row.id))}`
    : [];
  const sourcesById = new Map<number, { source: string; absent_at: Date | null }[]>();
  for (const row of sourceRows) {
    const list = sourcesById.get(Number(row.loadout_id)) ?? [];
    list.push({ source: row.source, absent_at: row.absent_at });
    sourcesById.set(Number(row.loadout_id), list);
  }
  const plan = planCleanup({
    seasonCertain: season.confidence === "certain",
    seasonStart: season.startsOn,
    fetchFailed,
    dryRun: options.dryRun,
    max: options.max,
    minFresh: options.minFresh,
    fresh: freshRow?.n ?? 0,
    listKnown: officialKnown,
    codes: rows.map((row) => {
      const sources = sourcesById.get(Number(row.id)) ?? [];
      return {
        id: Number(row.id),
        source: row.source,
        sources: sources.map((item) => item.source),
        postedOn: row.noted_at ? beijingDate(row.noted_at) : null,
        fetchedOn: row.fetched_at ? beijingDate(row.fetched_at) : null,
        onOfficialList: onOfficialList(sources),
      };
    }),
  });
  console.log(JSON.stringify({
    level: plan.skipped ? "error" : "info",
    msg: "loadout cleanup",
    skipped: plan.skipped,
    dryRun: plan.dryRun,
    capped: plan.capped,
    count: plan.ids.length,
    bySource: plan.bySource,
    season: season.confidence === "certain" ? season.startsOn : null,
  }));
  if (plan.skipped || plan.dryRun || !plan.ids.length) return { ...plan, deleted: 0 };
  const deleted = await db<{ id: number }[]>`DELETE FROM loadout_codes WHERE id IN ${db(plan.ids)} RETURNING id`;
  return { ...plan, deleted: deleted.length };
}
