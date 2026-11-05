// 过季的改枪码直接删掉，连同来源和官方详情（外键级联）。
// 开季日之前的日期、以及没有日期的，都删，官方码也一样。
// 开季后又被来源抓到的码，收录时写成抓取日（或来源自己给的、不早于开季日的日期），这里就不会再当无日期删掉。
// 来源若仍带着开季前的日期，decideLoadout 不会重新收录，所以删掉的旧码不会被聚合站写回来再删一轮。
// 不删的情况只剩：赛季没确认，或这一轮真有来源抓取失败。新赛季可以是 0 条。一轮删完，不截断。
// 删之前靠已有的本地 pg_dump。LOADOUT_CLEANUP_DRY_RUN=true 时只记会删哪些。
import type { Db } from "@aihot/backend/db";
import { sql } from "@aihot/backend/db";
import { beijingDate } from "@aihot/contracts/time";
import { GAME_ID } from "./catalog.ts";
import { AMS_FEED_ID, NSS_FEED_ID } from "./feeds.ts";
import { currentSeason } from "./season.ts";

const RECENT_FAILURE_MS = 12 * 60 * 60 * 1000;
const DELETE_CHUNK = 500;

/** 参与改枪码列表的来源。值为 null 的跟着 COLLECT_ENABLED，其余还要自己的开关。价格、梯队、理论 TTK 不算。 */
const CODE_FEED_FLAGS: Record<string, string | null> = {
  [AMS_FEED_ID]: "LOADOUT_AMS_ENABLED",
  [NSS_FEED_ID]: "LOADOUT_NSS_ENABLED",
  yufan: null,
  yunmaku: null,
  sjzgq: null,
};

export interface CleanupCode {
  id: number;
  source: string | null;
  sources: string[];
  postedOn: string | null;
}

export interface CleanupPlan {
  ids: number[];
  bySource: Record<string, number>;
  skipped: string | null;
  dryRun: boolean;
}

export function cleanupOptions(env: NodeJS.ProcessEnv = process.env): { dryRun: boolean } {
  return { dryRun: env.LOADOUT_CLEANUP_DRY_RUN === "true" };
}

/** 没有发布日，或发布日早于开季日。官方码同样算过季。 */
export function outOfSeason(code: Pick<CleanupCode, "postedOn">, seasonStart: string): boolean {
  return !code.postedOn || code.postedOn < seasonStart;
}

export function planCleanup(input: {
  seasonCertain: boolean;
  seasonStart: string;
  fetchFailed: boolean;
  dryRun: boolean;
  codes: readonly CleanupCode[];
}): CleanupPlan {
  const empty = { ids: [], bySource: {}, dryRun: input.dryRun };
  if (!input.seasonCertain) return { ...empty, skipped: "赛季没有确认，不删" };
  if (input.fetchFailed) return { ...empty, skipped: "这一轮有来源抓取失败，不删" };
  const matches = input.codes.filter((code) => outOfSeason(code, input.seasonStart));
  matches.sort((a, b) => a.id - b.id);
  const bySource: Record<string, number> = {};
  for (const code of matches) {
    const names = code.sources.length ? code.sources : [code.source ?? "article"];
    for (const name of new Set(names)) bySource[name] = (bySource[name] ?? 0) + 1;
  }
  return { ids: matches.map((code) => code.id), bySource, skipped: null, dryRun: input.dryRun };
}

interface FeedHealth {
  id: string;
  health: string;
  last_fetch_at: Date | null;
  last_ok_at: Date | null;
  last_error: string | null;
}

function codeFeedOpen(id: string, env: NodeJS.ProcessEnv): boolean {
  if (env.COLLECT_ENABLED !== "true") return false;
  if (!(id in CODE_FEED_FLAGS)) return false;
  const flag = CODE_FEED_FLAGS[id];
  return flag == null || env[flag] === "true";
}

/**
 * 最近 12 小时里，仍开着、而且曾经成功过的改枪码来源抓取失败，就整轮不删。
 * 从未成功、被 robots 拦住、已关闭、或不属于改枪码列表的来源不算。
 */
export function recentFetchFailed(feeds: readonly FeedHealth[], now = new Date(), env: NodeJS.ProcessEnv = process.env): boolean {
  const cutoff = now.getTime() - RECENT_FAILURE_MS;
  return feeds.some((feed) => {
    if (!codeFeedOpen(feed.id, env)) return false;
    if (!feed.last_fetch_at || feed.last_fetch_at.getTime() < cutoff) return false;
    if (feed.health === "ok" && !feed.last_error) return false;
    if (!feed.last_ok_at) return false;
    if (feed.last_error && /robots\.txt/i.test(feed.last_error)) return false;
    return true;
  });
}

/** 国服配装已停用。真正删除时清掉它的码和记账；预览不动库里的码。 */
async function retireDeltaCode(db: Db, dryRun: boolean): Promise<number> {
  if (!dryRun) {
    const dropped = await db<{ id: number }[]>`DELETE FROM loadout_codes WHERE source = 'deltacode' RETURNING id`;
    await db`DELETE FROM loadout_code_sources WHERE source = 'deltacode'`;
    await db`DELETE FROM loadout_feeds WHERE id = 'deltacode'`;
    return dropped.length;
  }
  const [row] = await db<{ n: number }[]>`SELECT count(*)::int AS n FROM loadout_codes WHERE source = 'deltacode'`;
  return row?.n ?? 0;
}

export async function cleanupOutOfSeason(deps: { db?: Db; now?: Date; env?: NodeJS.ProcessEnv; dryRun?: boolean } = {}): Promise<CleanupPlan & { deleted: number; retiredDelta: number }> {
  const db = deps.db ?? sql;
  const now = deps.now ?? new Date();
  const today = beijingDate(now);
  const options = cleanupOptions(deps.env ?? process.env);
  const dryRun = deps.dryRun ?? options.dryRun;
  const env = deps.env ?? process.env;
  const retiredDelta = await retireDeltaCode(db, dryRun);
  const season = await currentSeason(db, today);
  const feeds = await db<FeedHealth[]>`SELECT id, health, last_fetch_at, last_ok_at, last_error FROM loadout_feeds`;
  const fetchFailed = recentFetchFailed(feeds, now, env);
  const rows = await db<{ id: number; source: string | null; noted_at: Date | null }[]>`
    SELECT id, source, noted_at FROM loadout_codes WHERE game_id = ${GAME_ID}`;
  const sourceRows = rows.length
    ? await db<{ loadout_id: number; source: string }[]>`
        SELECT loadout_id, source FROM loadout_code_sources WHERE loadout_id IN ${db(rows.map((row) => row.id))}`
    : [];
  const sourcesById = new Map<number, string[]>();
  for (const row of sourceRows) {
    const list = sourcesById.get(Number(row.loadout_id)) ?? [];
    list.push(row.source);
    sourcesById.set(Number(row.loadout_id), list);
  }
  const plan = planCleanup({
    seasonCertain: season.confidence === "certain",
    seasonStart: season.startsOn,
    fetchFailed,
    dryRun,
    codes: rows.map((row) => ({
      id: Number(row.id),
      source: row.source,
      sources: sourcesById.get(Number(row.id)) ?? [],
      postedOn: row.noted_at ? beijingDate(row.noted_at) : null,
    })),
  });
  console.log(JSON.stringify({
    level: plan.skipped ? "error" : "info",
    msg: "loadout cleanup",
    skipped: plan.skipped,
    dryRun: plan.dryRun,
    count: plan.ids.length,
    bySource: plan.bySource,
    retiredDelta,
    season: season.confidence === "certain" ? season.startsOn : null,
  }));
  if (plan.skipped || plan.dryRun || !plan.ids.length) return { ...plan, deleted: 0, retiredDelta };
  let deleted = 0;
  for (let i = 0; i < plan.ids.length; i += DELETE_CHUNK) {
    const chunk = plan.ids.slice(i, i + DELETE_CHUNK);
    const removed = await db<{ id: number }[]>`DELETE FROM loadout_codes WHERE id IN ${db(chunk)} RETURNING id`;
    deleted += removed.length;
  }
  return { ...plan, deleted, retiredDelta };
}
