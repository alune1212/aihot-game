// 当前赛季从官方公告识别，不靠手改日期。
// 可靠来源是官网新闻和公告列表（和 df-official-news / df-official-notices 同一条公开接口）：
// 标题里同时有赛季名、一个公历日期，以及「开启」或「上线」。
// 改枪台方案列表和 dfm/config.list 没有赛季名或开季日，不用它们推进赛季。
// 识别失败就保持上一次确认过的赛季；都没有时用环境变量，再没有就停在内置的 S11「群星」，
// 并记成不确定。不确定时不换季，也不删码。
import type { Db } from "@aihot/backend/db";
import { sql } from "@aihot/backend/db";
import { beijingDate } from "@aihot/contracts/time";
import { guardedFetch } from "@aihot/backend/lib/http-fetch";
import { SEASON_START } from "./feeds.ts";

export interface SeasonCandidate {
  name: string;
  number: number | null;
  startsOn: string;
  evidence: string;
}

export interface StoredSeason extends SeasonCandidate {
  source: string;
  confidence: "certain" | "uncertain";
  detectedAt: string | null;
}

export const BUILTIN_SEASON: StoredSeason = {
  name: "群星",
  number: 11,
  startsOn: SEASON_START,
  source: "builtin",
  confidence: "uncertain",
  evidence: "内置的 S11 群星开季日。官方公告还没确认过，不能拿它换季或删码。",
  detectedAt: null,
};

/** 官网新闻、公告列表。和 industry/sources.json 里 df-official-* 是同一组公开地址。 */
export const OFFICIAL_SEASON_LISTS = [
  { id: "notices", url: "https://comm.ams.game.qq.com/ide/?iChartId=329849&iSubChartId=329849&sIdeToken=o3Iw53&chanid=6896&typeids=1&limit=20&start=0" },
  { id: "news", url: "https://comm.ams.game.qq.com/ide/?iChartId=329849&iSubChartId=329849&sIdeToken=o3Iw53&chanid=6898&typeids=1&limit=20&start=0" },
] as const;

const SOURCE_IDS = ["df-official-notices", "df-official-news"] as const;
const NAME_BEFORE = /新赛季\s*[「『【“"]([^」』】”"]{1,12})[」』】”"]/u;
const NAME_AFTER = /[「『【“"]([^」』】”"]{1,12})[」』】”"]\s*赛季/u;
const DATE_IN_TITLE = /(\d{1,2})月(\d{1,2})日/g;
const NUMBER_IN_TITLE = /(?:^|[^A-Za-z0-9])S(\d{1,2})(?!\d)|第(\d{1,2})赛季/u;

export interface Announcement {
  title: string;
  publishedOn: string;
}

function isoDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const startsOn = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const check = new Date(`${startsOn}T00:00:00Z`);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() + 1 !== month || check.getUTCDate() !== day) return null;
  return startsOn;
}

function daysBetween(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  return Math.round((end - start) / 86400000);
}

/** 标题里能确定的开季日。对不上、或日期和发稿日离得太远，就返回 null，不当成新赛季。 */
export function parseSeasonAnnouncement(item: Announcement): SeasonCandidate | null {
  const title = item.title.replace(/\s+/g, " ").trim();
  const publishedOn = item.publishedOn;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(publishedOn)) return null;
  if (!/开启|上线/.test(title)) return null;
  const before = NAME_BEFORE.exec(title)?.[1]?.trim() ?? null;
  const after = NAME_AFTER.exec(title)?.[1]?.trim() ?? null;
  if (before && after && before !== after) return null;
  const name = before ?? after;
  if (!name || name === "新" || name === "当前") return null;
  const dates = [...title.matchAll(DATE_IN_TITLE)];
  if (dates.length !== 1) return null;
  const month = Number(dates[0]![1]);
  const day = Number(dates[0]![2]);
  const year = Number(publishedOn.slice(0, 4));
  let startsOn: string | null = null;
  for (const candidate of [year, year + 1]) {
    const date = isoDate(candidate, month, day);
    if (!date) continue;
    const delta = daysBetween(publishedOn, date);
    if (delta >= -3 && delta <= 45) {
      startsOn = date;
      break;
    }
  }
  if (!startsOn) return null;
  const numberMatch = NUMBER_IN_TITLE.exec(title);
  const number = numberMatch ? Number(numberMatch[1] ?? numberMatch[2]) : null;
  return { name, number: number && number > 0 ? number : null, startsOn, evidence: title.slice(0, 180) };
}

/** 同一个赛季名只能有一个开季日。互相矛盾的名字整组丢掉。 */
export function consistentSeasons(candidates: readonly SeasonCandidate[]): { seasons: SeasonCandidate[]; rejected: string[] } {
  const grouped = new Map<string, SeasonCandidate[]>();
  for (const candidate of candidates) {
    const list = grouped.get(candidate.name) ?? [];
    list.push(candidate);
    grouped.set(candidate.name, list);
  }
  const seasons: SeasonCandidate[] = [];
  const rejected: string[] = [];
  for (const [name, list] of grouped) {
    const dates = new Set(list.map((item) => item.startsOn));
    if (dates.size !== 1) {
      rejected.push(name);
      continue;
    }
    const withNumber = list.find((item) => item.number != null) ?? list[0]!;
    seasons.push(withNumber);
  }
  seasons.sort((a, b) => a.startsOn.localeCompare(b.startsOn) || a.name.localeCompare(b.name, "zh"));
  return { seasons, rejected };
}

/** 已经开始的、开季日最晚的那一季。还没到开季日的只先记下来。 */
export function activeSeason(seasons: readonly StoredSeason[], today = beijingDate(new Date())): StoredSeason | null {
  const started = seasons.filter((season) => season.confidence === "certain" && season.startsOn <= today);
  started.sort((a, b) => b.startsOn.localeCompare(a.startsOn));
  return started[0] ?? null;
}

export function seasonLabel(season: Pick<StoredSeason, "name" | "number">): string {
  return season.number ? `S${season.number} ${season.name}` : season.name;
}

export function seasonFromEnv(env: NodeJS.ProcessEnv = process.env): SeasonCandidate | null {
  const startsOn = env.LOADOUT_SEASON_START?.trim() ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startsOn)) return null;
  const check = new Date(`${startsOn}T00:00:00Z`);
  if (Number.isNaN(check.getTime()) || check.toISOString().slice(0, 10) !== startsOn) return null;
  const name = env.LOADOUT_SEASON_NAME?.trim() || "当前赛季";
  const numberRaw = env.LOADOUT_SEASON_NUMBER?.trim() ?? "";
  const number = /^\d{1,2}$/.test(numberRaw) ? Number(numberRaw) : null;
  return { name: name.slice(0, 16), number: number && number > 0 ? number : null, startsOn, evidence: "环境变量 LOADOUT_SEASON_START" };
}

export function parseOfficialNewsBody(body: string): { ok: true; items: Announcement[] } | { ok: false; reason: string } {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return { ok: false, reason: "官方公告不是 JSON" };
  }
  const root = json && typeof json === "object" ? json as Record<string, unknown> : null;
  const ret = root?.ret;
  if (ret !== 0 && ret !== "0") return { ok: false, reason: `官方公告 ret ${String(ret ?? "?")}` };
  const data = root?.jData && typeof root.jData === "object" ? (root.jData as Record<string, unknown>).data : null;
  const items = data && typeof data === "object" ? (data as Record<string, unknown>).items : null;
  if (!Array.isArray(items)) return { ok: false, reason: "官方公告没有 items" };
  const parsed: Announcement[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const title = typeof row.sTitle === "string" ? row.sTitle : "";
    const when = typeof row.sIdxTime === "string" ? /^(\d{4}-\d{2}-\d{2})/.exec(row.sIdxTime)?.[1] : null;
    if (!title || !when) continue;
    parsed.push({ title, publishedOn: when });
  }
  return { ok: true, items: parsed };
}

export async function readStoredSeasons(db: Db): Promise<StoredSeason[]> {
  const rows = await db<{ name: string; number: number | null; starts_on: Date | string; source: string; confidence: string; evidence: string; detected_at: Date }[]>`
    SELECT name, number, starts_on, source, confidence, evidence, detected_at FROM loadout_seasons ORDER BY starts_on, id`;
  return rows.map((row) => ({
    name: row.name,
    number: row.number,
    startsOn: typeof row.starts_on === "string" ? row.starts_on.slice(0, 10) : row.starts_on.toISOString().slice(0, 10),
    source: row.source,
    confidence: row.confidence === "certain" ? "certain" : "uncertain",
    evidence: row.evidence,
    detectedAt: row.detected_at.toISOString(),
  }));
}

export async function currentSeason(db: Db, today = beijingDate(new Date())): Promise<StoredSeason> {
  return activeSeason(await readStoredSeasons(db), today) ?? { ...BUILTIN_SEASON };
}

/** 收录和「过季」用的开季日。没确认过就用内置的 S11，不往前推进。 */
export async function seasonFloor(db: Db = sql, today = beijingDate(new Date())): Promise<string> {
  const season = await currentSeason(db, today);
  return season.confidence === "certain" ? season.startsOn : SEASON_START;
}

async function rememberSeason(db: Db, season: SeasonCandidate, source: string): Promise<void> {
  const existing = await db<{ starts_on: Date | string }[]>`
    SELECT starts_on FROM loadout_seasons WHERE name = ${season.name} AND confidence = 'certain'`;
  const dates = new Set(existing.map((row) => typeof row.starts_on === "string" ? row.starts_on.slice(0, 10) : row.starts_on.toISOString().slice(0, 10)));
  if (dates.size && !dates.has(season.startsOn)) {
    console.error(JSON.stringify({ level: "error", msg: "loadout season conflict", name: season.name, kept: [...dates], ignored: season.startsOn, evidence: season.evidence }));
    return;
  }
  if (dates.has(season.startsOn)) return;
  await db`INSERT INTO loadout_seasons (name, number, starts_on, source, confidence, evidence)
    VALUES (${season.name}, ${season.number}, ${season.startsOn}, ${source}, 'certain', ${season.evidence})`;
}

export interface SeasonDetection {
  ok: boolean;
  reason: string;
  stored: number;
  current: StoredSeason;
}

/** 先看已经采集的官方公告，没有再请求官网列表。失败时大声记一条，不写入新赛季。 */
export async function detectSeason(deps: {
  db?: Db;
  fetch?: (url: string) => Promise<{ status: number; text: string }>;
  env?: NodeJS.ProcessEnv;
  now?: Date;
} = {}): Promise<SeasonDetection> {
  const db = deps.db ?? sql;
  const env = deps.env ?? process.env;
  const today = beijingDate(deps.now ?? new Date());
  const fromDb = await db<{ title: string; published_at: Date | null }[]>`
    SELECT title, published_at FROM articles
    WHERE source_id IN ${db([...SOURCE_IDS])} AND published_at IS NOT NULL
    ORDER BY published_at DESC
    LIMIT 80`;
  const announcements: Announcement[] = fromDb.flatMap((row) => {
    if (!row.published_at) return [];
    return [{ title: row.title, publishedOn: beijingDate(row.published_at) }];
  });
  let liveFailed: string | null = announcements.length ? null : "库里还没有官方公告";
  if (!announcements.some((item) => parseSeasonAnnouncement(item))) {
    const fetchPage = deps.fetch ?? (async (url: string) => {
      const res = await guardedFetch(url, { route: "egress", timeoutMs: 25_000, maxBytes: 2_000_000 });
      return { status: res.status, text: res.text() };
    });
    liveFailed = null;
    for (const list of OFFICIAL_SEASON_LISTS) {
      try {
        const res = await fetchPage(list.url);
        if (res.status !== 200) {
          liveFailed = `${list.id} HTTP ${res.status}`;
          continue;
        }
        const parsed = parseOfficialNewsBody(res.text);
        if (!parsed.ok) {
          liveFailed = `${list.id} ${parsed.reason}`;
          continue;
        }
        announcements.push(...parsed.items);
      } catch (error) {
        liveFailed = error instanceof Error ? error.message : String(error);
      }
    }
  }
  const { seasons, rejected } = consistentSeasons(announcements.flatMap((item) => {
    const parsed = parseSeasonAnnouncement(item);
    return parsed ? [parsed] : [];
  }));
  if (rejected.length) {
    console.error(JSON.stringify({ level: "error", msg: "loadout season ambiguous", names: rejected }));
  }
  if (seasons.length) {
    for (const season of seasons) await rememberSeason(db, season, "announcement");
    const current = await currentSeason(db, today);
    console.log(JSON.stringify({ level: "info", msg: "loadout season", name: current.name, number: current.number, startsOn: current.startsOn, confidence: current.confidence, found: seasons.map((season) => `${season.name}@${season.startsOn}`) }));
    return { ok: current.confidence === "certain", reason: current.confidence === "certain" ? "announcement" : "stored season has not started", stored: seasons.length, current };
  }
  const fallback = seasonFromEnv(env);
  if (fallback) {
    await rememberSeason(db, fallback, "env");
    const current = await currentSeason(db, today);
    console.error(JSON.stringify({ level: "error", msg: "loadout season detection failed, using LOADOUT_SEASON_START", reason: liveFailed, startsOn: fallback.startsOn }));
    return { ok: current.confidence === "certain", reason: "env", stored: 1, current };
  }
  const current = await currentSeason(db, today);
  console.error(JSON.stringify({
    level: "error",
    msg: "loadout season detection failed",
    reason: liveFailed ?? "官方公告里没有同时写明赛季名和开季日的标题",
    kept: current.confidence === "certain" ? current.startsOn : SEASON_START,
    confidence: current.confidence,
  }));
  return { ok: false, reason: liveFailed ?? "no announcement", stored: 0, current };
}
