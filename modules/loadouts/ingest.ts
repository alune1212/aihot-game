// 官方方案列表、鸟兽兽、DFTTK 和聪聪梯队。每个源单独跑，一个失败不影响另一个。
// 请求走 guardedFetch：设了 EGRESS_PROXY_URL 就走出网代理，.cn 和官方接口按框架规则直连。
import { SITE } from "@aihot/site";
import { guardedFetch } from "@aihot/backend/lib/http-fetch";
import { sql } from "@aihot/backend/db";
import { parseSolutionCodes, qqCookie } from "./ams.ts";
import { decideLoadout, mergeRaw, type FeedRow, type RawLoadout } from "./codes.ts";
import { postAms, type IdeFetch } from "./detail.ts";
import {
  AMS_FEED_ID,
  DFTTK_FEED_ID,
  DFTTK_MANIFEST,
  DFTTK_ORIGIN,
  NSS_FEED_ID,
  NSS_ORIGIN,
  SEASON_START,
  TIER_FEED_ID,
  TIER_PAGE,
  nssGunUrl,
} from "./feeds.ts";
import { absoluteDfttk, parseDfttkNames, parseDfttkPlan, parseDfttkPreview, parseDfttkRanking, parseRankingIndex } from "./parse-dfttk.ts";
import { nssLastPage, parseNss } from "./parse-nss.ts";
import { parseTierList } from "./parse-tier.ts";
import { mayFetch } from "./robots.ts";
import { seasonFloor } from "./season.ts";
import { noteStaleLoadouts, reconcileFeedSources, recordFeedFailure, recordFeedSuccess, saveFeedLoadout, saveWeaponTier, saveWeaponTtk } from "./store.ts";
import { beijingDate } from "@aihot/contracts/time";

const REQUEST_GAP_MS = 1200;
const AMS_PAGE_SIZE = 20;
/** shortcut: 官方方案现在约 850 条、每页 20 条。超过 60 页就停，剩下的等下一轮。 */
export const AMS_PAGE_CAP = 60;
/** shortcut: 鸟兽兽一页 20 条，现在约 70 页。超过 90 页就停。 */
export const NSS_PAGE_CAP = 90;
const ATTEMPTS = 3;

export interface PageResponse {
  status: number;
  text(): string;
}

export interface PageInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export type PageFetch = (url: string, init?: PageInit) => Promise<PageResponse>;

export interface Gathered {
  rows: FeedRow[];
  stale: FeedRow[];
  rejected: { shape: number; international: number; unmapped: number; undated: number };
  unmapped: string[];
  byMode: Record<string, number>;
  warning: string | null;
}

async function pause(sleep: (ms: number) => Promise<void>): Promise<void> {
  await sleep(REQUEST_GAP_MS);
}

async function readPage(fetchPage: PageFetch, sleep: (ms: number) => Promise<void>, url: string, init?: PageInit): Promise<string> {
  let last = "没有响应";
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    await pause(sleep);
    try {
      const res = await fetchPage(url, init);
      if (res.status === 200) return res.text();
      last = `HTTP ${res.status} for ${url}`;
      if (res.status === 403 || res.status === 404 || (res.status < 500 && res.status !== 429)) break;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
  }
  throw new Error(last);
}

async function robotsOf(fetchPage: PageFetch, sleep: (ms: number) => Promise<void>, url: string): Promise<{ status: number; body: string }> {
  await pause(sleep);
  const res = await fetchPage(url);
  const body = res.status === 200 || res.status === 404 ? res.text() : "";
  return { status: res.status, body };
}

function allow(status: number, body: string, url: string): boolean {
  return mayFetch(status, body, url, SITE.crawlerName);
}

function classify(raws: readonly RawLoadout[], seasonStart = SEASON_START): Gathered {
  const rows: FeedRow[] = [];
  const stale: FeedRow[] = [];
  const rejected = { shape: 0, international: 0, unmapped: 0, undated: 0 };
  const unmapped: string[] = [];
  const byMode: Record<string, number> = {};
  for (const raw of mergeRaw(raws)) {
    const decision = decideLoadout(raw, seasonStart);
    if (decision.ok) {
      rows.push(decision.row);
      byMode[decision.row.mode] = (byMode[decision.row.mode] ?? 0) + 1;
    } else if (decision.reason === "stale") {
      stale.push(decision.row);
    } else if (decision.reason === "unmapped") {
      rejected.unmapped += 1;
      if (decision.detail && !unmapped.includes(decision.detail)) unmapped.push(decision.detail);
    } else {
      rejected[decision.reason] += 1;
    }
  }
  return { rows, stale, rejected, unmapped, byMode, warning: null };
}

function summarize(sourceName: string, gathered: Gathered, counts: { inserted: number; updated: number; kept: number; staleNoted: number }): string {
  const modes = Object.entries(gathered.byMode).map(([mode, count]) => `${mode} ${count}`).join("，");
  const unmapped = gathered.unmapped.slice(0, 12).join("、");
  return [
    `${sourceName}：新收录 ${counts.inserted}，更新 ${counts.updated}，已有来源 ${counts.kept}`,
    modes ? `按模式 ${modes}` : "",
    `丢弃格式 ${gathered.rejected.shape}、国际服 ${gathered.rejected.international}、无日期 ${gathered.rejected.undated}、过季 ${gathered.stale.length}、对不上枪 ${gathered.rejected.unmapped}`,
    gathered.stale.length ? `其中 ${counts.staleNoted} 条过季日期写回了已有记录` : "",
    unmapped ? `对不上的枪：${unmapped}` : "",
    gathered.warning,
  ].filter(Boolean).join("。").slice(0, 500);
}

async function storeGathered(sourceId: string, sourceName: string, gathered: Gathered, fetchedAt: Date): Promise<Record<string, unknown>> {
  const counts = { inserted: 0, updated: 0, kept: 0, staleNoted: 0 };
  for (const row of gathered.rows) {
    const result = await saveFeedLoadout(sql, sourceId, row, fetchedAt);
    counts[result] += 1;
  }
  counts.staleNoted = await noteStaleLoadouts(sql, sourceId, gathered.stale);
  if (!gathered.warning) {
    const listed = [...gathered.rows, ...gathered.stale].map((row) => row.code);
    await reconcileFeedSources(sql, sourceId, listed);
  }
  const note = summarize(sourceName, gathered, counts);
  await recordFeedSuccess(sql, sourceId, sourceName, note);
  return { ok: true, ...counts, stale: gathered.stale.length, ...gathered.rejected, byMode: gathered.byMode, unmapped: gathered.unmapped, warning: gathered.warning };
}

async function runFeed(
  id: string,
  name: string,
  gather: (fetchPage: PageFetch, sleep: (ms: number) => Promise<void>, seasonStart: string) => Promise<Gathered>,
  deps: { fetch?: PageFetch; sleep?: (ms: number) => Promise<void>; now?: () => Date },
): Promise<Record<string, unknown>> {
  const fetchPage = deps.fetch ?? defaultFetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = deps.now ?? (() => new Date());
  const startsOn = await seasonFloor(sql, beijingDate(now()));
  try {
    return await storeGathered(id, name, await gather(fetchPage, sleep, startsOn), now());
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
    await recordFeedFailure(sql, id, name, message);
    return { ok: false, error: message };
  }
}

async function defaultFetch(url: string, init?: PageInit): Promise<PageResponse> {
  const res = await guardedFetch(url, {
    method: init?.method,
    headers: init?.headers,
    body: init?.body,
    route: "egress",
    timeoutMs: 25_000,
    maxBytes: init?.method === "POST" ? 4_000_000 : 3_000_000,
  });
  return { status: res.status, text: () => res.text() };
}

/** 官方改枪台方案列表。匿名可读。新码只入库，配件和属性留给 loadouts.detail。 */
export async function gatherAms(fetchPage: PageFetch, sleep: (ms: number) => Promise<void>, env: { DF_QQ_COOKIE?: string } = process.env, seasonStart = SEASON_START): Promise<Gathered> {
  const cookie = qqCookie(env);
  const ide = fetchPage as IdeFetch;
  const raws: RawLoadout[] = [];
  let warning: string | null = null;
  let page = 1;
  let total = AMS_PAGE_SIZE;
  while (page <= AMS_PAGE_CAP && (page - 1) * AMS_PAGE_SIZE < total) {
    const result = await postAms(ide, sleep, "dfm/solution.arms.list", { page, limit: AMS_PAGE_SIZE, solutionType: "gun" }, cookie);
    if (!result.ok) {
      const message = result.message;
      if (page === 1) throw new Error(message);
      warning = message;
      break;
    }
    const parsed = parseSolutionCodes(result.data);
    if (!parsed) {
      const message = "官方方案列表的结构变了";
      if (page === 1) throw new Error(message);
      warning = message;
      break;
    }
    total = parsed.total;
    for (const item of parsed.items) {
      raws.push({
        code: item.code,
        weaponHint: item.weaponHint,
        author: item.author,
        priceText: null,
        postedOn: item.postedOn,
        sourceUrl: "",
        popularity: item.applyNum,
        likes: item.likeNum,
      });
    }
    if (!parsed.items.length) break;
    page += 1;
  }
  if (!warning && (page - 1) * AMS_PAGE_SIZE < total && page > AMS_PAGE_CAP) warning = `官方方案超过 ${AMS_PAGE_CAP} 页，这一轮没翻完`;
  if (!raws.length) throw new Error(warning ?? "官方方案列表里没有改枪码");
  return { ...classify(raws, seasonStart), warning };
}

export function fetchAmsCodes(deps: { fetch?: PageFetch; sleep?: (ms: number) => Promise<void>; now?: () => Date; env?: { DF_QQ_COOKIE?: string } } = {}): Promise<Record<string, unknown>> {
  return runFeed(AMS_FEED_ID, "官方方案列表", (fetchPage, sleep, seasonStart) => gatherAms(fetchPage, sleep, deps.env, seasonStart), deps);
}

/** 鸟兽兽 /gun。只抓公开 HTML，间隔不短于 robots 的 Crawl-delay。 */
export async function gatherNss(fetchPage: PageFetch, sleep: (ms: number) => Promise<void>, seasonStart = SEASON_START): Promise<Gathered> {
  const robots = await robotsOf(fetchPage, sleep, `${NSS_ORIGIN}/robots.txt`);
  const firstUrl = nssGunUrl(1);
  if (!allow(robots.status, robots.body, firstUrl)) throw new Error("robots.txt 不允许抓取鸟兽兽改枪码");
  const pages: Array<{ url: string; html: string }> = [];
  let warning: string | null = null;
  let last = 1;
  for (let page = 1; page <= NSS_PAGE_CAP && page <= last; page++) {
    const url = nssGunUrl(page);
    if (!allow(robots.status, robots.body, url)) {
      warning = "robots.txt 不允许鸟兽兽后面的页";
      break;
    }
    try {
      const html = await readPage(fetchPage, sleep, url);
      pages.push({ url, html });
      last = Math.max(last, Math.min(NSS_PAGE_CAP, nssLastPage(html)));
      if (!/data-copy="/i.test(html)) break;
    } catch (error) {
      warning = error instanceof Error ? error.message : String(error);
      break;
    }
  }
  if (!pages.length) throw new Error(warning ?? "鸟兽兽没有页面");
  if (last >= NSS_PAGE_CAP) warning = warning ?? `鸟兽兽超过 ${NSS_PAGE_CAP} 页，这一轮没翻完`;
  const raws = pages.flatMap((page) => parseNss(page.html, page.url));
  if (!raws.length && pages.some((page) => /data-card/.test(page.html))) throw new Error("鸟兽兽页面结构变了，没有抽出改枪码");
  return { ...classify(raws, seasonStart), warning };
}

export function fetchNssCodes(deps: { fetch?: PageFetch; sleep?: (ms: number) => Promise<void>; now?: () => Date } = {}): Promise<Record<string, unknown>> {
  return runFeed(NSS_FEED_ID, "鸟兽兽", gatherNss, deps);
}

async function readJson(fetchPage: PageFetch, sleep: (ms: number) => Promise<void>, robots: { status: number; body: string }, url: string): Promise<string> {
  if (!allow(robots.status, robots.body, url)) throw new Error(`robots.txt 不允许抓取 ${url}`);
  return readPage(fetchPage, sleep, url, { headers: { accept: "application/json" } });
}

/** DFTTK 的默认烽火排名（一套护甲、弹药和命中分布）和体验服观察。失败不改已有缓存。 */
export async function gatherTtk(fetchPage: PageFetch, sleep: (ms: number) => Promise<void>): Promise<{ rows: Array<{ weapon: string; ttk: unknown; patch: unknown | null }>; unmapped: string[]; warning: string | null }> {
  const robots = await robotsOf(fetchPage, sleep, `${DFTTK_ORIGIN}/robots.txt`);
  const manifest = await readJson(fetchPage, sleep, robots, DFTTK_MANIFEST);
  const plan = parseDfttkPlan(manifest, DFTTK_ORIGIN);
  const names = parseDfttkNames(await readJson(fetchPage, sleep, robots, plan.itemsUrl));
  const index = parseRankingIndex(await readJson(fetchPage, sleep, robots, plan.indexUrl));
  const rankingUrl = absoluteDfttk(plan.baseUrl, index.file);
  const ranking = parseDfttkRanking(await readJson(fetchPage, sleep, robots, rankingUrl), names, index.label);
  let warning: string | null = null;
  const patches = new Map<string, { observedAt: string | null; version: string | null; lines: string[] }>();
  if (plan.previewUrl) {
    try {
      const preview = parseDfttkPreview(await readJson(fetchPage, sleep, robots, plan.previewUrl), names);
      for (const row of preview.rows) patches.set(row.weapon, { observedAt: row.observedAt, version: row.version, lines: row.lines });
      for (const name of preview.unmapped) if (!ranking.unmapped.includes(name)) ranking.unmapped.push(name);
    } catch (error) {
      warning = error instanceof Error ? error.message : String(error);
    }
  }
  if (!ranking.rows.length) throw new Error(warning ?? "DFTTK 没有对上名录的枪");
  return {
    rows: ranking.rows.map((row) => ({
      weapon: row.weapon,
      ttk: { seconds: row.seconds, scenario: row.scenario, atMeters: row.atMeters, version: row.version, preview: row.preview },
      patch: patches.get(row.weapon) ?? null,
    })),
    unmapped: ranking.unmapped,
    warning,
  };
}

export async function fetchWeaponTtk(deps: { fetch?: PageFetch; sleep?: (ms: number) => Promise<void> } = {}): Promise<Record<string, unknown>> {
  const fetchPage = deps.fetch ?? defaultFetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  try {
    const gathered = await gatherTtk(fetchPage, sleep);
    for (const row of gathered.rows) await saveWeaponTtk(sql, row.weapon, row.ttk, row.patch);
    const unmapped = gathered.unmapped.slice(0, 12).join("、");
    const note = [`社区理论 TTK ${gathered.rows.length} 把枪`, unmapped ? `对不上的枪：${unmapped}` : "", gathered.warning].filter(Boolean).join("。").slice(0, 500);
    await recordFeedSuccess(sql, DFTTK_FEED_ID, "社区理论TTK", note);
    return { ok: true, guns: gathered.rows.length, unmapped: gathered.unmapped, warning: gathered.warning };
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
    await recordFeedFailure(sql, DFTTK_FEED_ID, "社区理论TTK", message);
    return { ok: false, error: message };
  }
}

/** 只收枪和梯队。这一页上的改枪码是国际服的，不入库。 */
export async function gatherTier(fetchPage: PageFetch, sleep: (ms: number) => Promise<void>): Promise<{ asOf: string | null; rows: Array<{ weapon: string; tier: string }>; unmapped: string[] }> {
  const robots = await robotsOf(fetchPage, sleep, "https://www.dfgqm.com/robots.txt");
  if (!allow(robots.status, robots.body, TIER_PAGE)) throw new Error("robots.txt 不允许抓取聪聪梯队");
  const html = await readPage(fetchPage, sleep, TIER_PAGE);
  const parsed = parseTierList(html);
  if (!parsed.rows.length && html.includes("tier-chip")) throw new Error("聪聪梯队的页面结构变了，没有对上枪");
  if (!parsed.rows.length) throw new Error("聪聪梯队页面里没有梯队");
  return parsed;
}

export async function fetchWeaponTiers(deps: { fetch?: PageFetch; sleep?: (ms: number) => Promise<void> } = {}): Promise<Record<string, unknown>> {
  const fetchPage = deps.fetch ?? defaultFetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  try {
    const gathered = await gatherTier(fetchPage, sleep);
    for (const row of gathered.rows) await saveWeaponTier(sql, row.weapon, row.tier, gathered.asOf);
    const unmapped = gathered.unmapped.slice(0, 12).join("、");
    const note = [`聪聪梯队 ${gathered.rows.length} 把枪${gathered.asOf ? `，更新于 ${gathered.asOf}` : ""}`, unmapped ? `对不上的枪：${unmapped}` : ""].filter(Boolean).join("。").slice(0, 500);
    await recordFeedSuccess(sql, TIER_FEED_ID, "聪聪梯队", note);
    return { ok: true, guns: gathered.rows.length, asOf: gathered.asOf, unmapped: gathered.unmapped };
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
    await recordFeedFailure(sql, TIER_FEED_ID, "聪聪梯队", message);
    return { ok: false, error: message };
  }
}
