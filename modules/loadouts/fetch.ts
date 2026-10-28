// 每 6 小时抓一次两个聚合站。只在 COLLECT_ENABLED=true 时由 worker 排程（和信源采集同一个开关）。
// 请求走 guardedFetch：设了 EGRESS_PROXY_URL 就走出网代理，.cn 按框架规则直连。不需要新的密钥。
import { SITE } from "@aihot/site";
import { guardedFetch } from "@aihot/backend/lib/http-fetch";
import { sql } from "@aihot/backend/db";
import { decideLoadout, mergeRaw, type FeedRow, type RawLoadout } from "./codes.ts";
import { SJZGQ_HOME, YUNMAKU_MODES, YUNMAKU_ORIGIN, yunmakuListUrl } from "./feeds.ts";
import { parseSjzgqCatalog, parseSjzgqHtml, sjzgqScriptUrl } from "./parse-sjzgq.ts";
import { parseYunmaku } from "./parse-yunmaku.ts";
import { mayFetch } from "./robots.ts";
import { noteStaleLoadouts, recordFeedFailure, recordFeedSuccess, saveFeedLoadout } from "./store.ts";

const REQUEST_GAP_MS = 1200;
/** shortcut: 一个模式最多 40 页，云码库烽火现在约 25 页；超过就先抬这里。 */
const PAGE_CAP = 40;

export interface PageResponse {
  status: number;
  text(): string;
}

export type PageFetch = (url: string) => Promise<PageResponse>;

export interface Gathered {
  rows: FeedRow[];
  stale: FeedRow[];
  rejected: { shape: number; international: number; unmapped: number };
  unmapped: string[];
  byMode: Record<string, number>;
  warning: string | null;
}

async function pause(sleep: (ms: number) => Promise<void>): Promise<void> {
  await sleep(REQUEST_GAP_MS);
}

async function readPage(fetchPage: PageFetch, sleep: (ms: number) => Promise<void>, url: string): Promise<string> {
  await pause(sleep);
  const res = await fetchPage(url);
  if (res.status !== 200) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
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

function classify(raws: readonly RawLoadout[]): Gathered {
  const rows: FeedRow[] = [];
  const stale: FeedRow[] = [];
  const rejected = { shape: 0, international: 0, unmapped: 0 };
  const unmapped: string[] = [];
  const byMode: Record<string, number> = {};
  for (const raw of mergeRaw(raws)) {
    const decision = decideLoadout(raw);
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

async function pullAllowed(
  fetchPage: PageFetch,
  sleep: (ms: number) => Promise<void>,
  robots: { status: number; body: string },
  url: string,
): Promise<string | null> {
  if (!allow(robots.status, robots.body, url)) return null;
  return readPage(fetchPage, sleep, url);
}

/** 云码库：首页 + 三个国服模式的列表页（分页跟页面上的 page=）。 */
export async function gatherYunmaku(fetchPage: PageFetch, sleep: (ms: number) => Promise<void>): Promise<Gathered> {
  const robots = await robotsOf(fetchPage, sleep, `${YUNMAKU_ORIGIN}/robots.txt`);
  const pages: Array<{ url: string; html: string }> = [];
  let warning: string | null = null;
  const take = async (url: string) => {
    const html = await pullAllowed(fetchPage, sleep, robots, url);
    if (html !== null) pages.push({ url, html });
  };
  const fail = (error: unknown) => {
    warning = error instanceof Error ? error.message : String(error);
  };
  // 连着抓太快时站点会回 403/429。停掉这个站剩下的页，等下一轮，不要继续撞。
  const blocked = () => /HTTP (403|429|503)/.test(warning ?? "");
  try {
    await take(`${YUNMAKU_ORIGIN}/`);
  } catch (error) {
    fail(error);
  }
  for (const mode of YUNMAKU_MODES) {
    if (blocked()) break;
    try {
      const firstUrl = yunmakuListUrl(mode);
      const first = await pullAllowed(fetchPage, sleep, robots, firstUrl);
      if (first === null) continue;
      pages.push({ url: firstUrl, html: first });
      let last = 1;
      for (const match of first.matchAll(/[?&]page=(\d+)/g)) last = Math.max(last, Number(match[1]));
      last = Math.min(PAGE_CAP, last);
      for (let page = 2; page <= last; page++) {
        try {
          await take(yunmakuListUrl(mode, page));
        } catch (error) {
          fail(error);
          break;
        }
      }
    } catch (error) {
      fail(error);
    }
  }
  if (!pages.length) throw new Error(warning ?? "robots.txt 不允许抓取云码库改枪码");
  const raws = pages.flatMap((page) => parseYunmaku(page.html, page.url));
  if (!raws.length && pages.some((page) => /<code\b|hot-card|loadout-grid/i.test(page.html))) throw new Error("云码库页面结构变了，没有抽出改枪码");
  return { ...classify(raws), warning };
}

/** 洲械库：首页 HTML，再加上它引用的目录脚本。脚本失败时仍保留首页那一页。 */
export async function gatherSjzgq(fetchPage: PageFetch, sleep: (ms: number) => Promise<void>): Promise<Gathered> {
  const robots = await robotsOf(fetchPage, sleep, new URL("/robots.txt", SJZGQ_HOME).toString());
  if (!allow(robots.status, robots.body, SJZGQ_HOME)) throw new Error("robots.txt 不允许抓取洲械库");
  const html = await readPage(fetchPage, sleep, SJZGQ_HOME);
  const raws = parseSjzgqHtml(html, SJZGQ_HOME);
  let warning: string | null = null;
  const script = sjzgqScriptUrl(html, SJZGQ_HOME);
  if (script && allow(robots.status, robots.body, script)) {
    try {
      const source = await readPage(fetchPage, sleep, script);
      const catalog = parseSjzgqCatalog(source, SJZGQ_HOME);
      if (catalog.length) raws.push(...catalog);
      else if (/code:`/.test(source)) warning = "洲械库目录脚本的写法变了，这一轮只用了首页";
    } catch (error) {
      warning = error instanceof Error ? error.message : String(error);
    }
  } else if (script) {
    warning = "robots.txt 不允许抓取洲械库目录脚本，这一轮只用了首页";
  }
  if (!raws.length) throw new Error(/loadout-row/.test(html) ? "洲械库页面结构变了，没有抽出改枪码" : warning ?? "洲械库页面里没有改枪码");
  return { ...classify(raws), warning };
}

function summarize(sourceName: string, gathered: Gathered, counts: { inserted: number; updated: number; kept: number; staleNoted: number }): string {
  const modes = Object.entries(gathered.byMode).map(([mode, count]) => `${mode} ${count}`).join("，");
  const unmapped = gathered.unmapped.slice(0, 12).join("、");
  return [
    `${sourceName}：新收录 ${counts.inserted}，更新 ${counts.updated}，已有来源 ${counts.kept}`,
    modes ? `按模式 ${modes}` : "",
    `丢弃格式 ${gathered.rejected.shape}、国际服 ${gathered.rejected.international}、过季 ${gathered.stale.length}、对不上枪 ${gathered.rejected.unmapped}`,
    gathered.stale.length ? `其中 ${counts.staleNoted} 条过季日期写回了已有记录` : "",
    unmapped ? `对不上的枪：${unmapped}` : "",
    gathered.warning,
  ].filter(Boolean).join("。").slice(0, 500);
}

async function defaultFetch(url: string): Promise<PageResponse> {
  const res = await guardedFetch(url, { route: "egress", timeoutMs: 25_000, maxBytes: 3_000_000 });
  return { status: res.status, text: () => res.text() };
}

const SOURCES = [
  { id: "yunmaku", name: "云码库", gather: gatherYunmaku },
  { id: "sjzgq", name: "洲械库", gather: gatherSjzgq },
] as const;

/** 两个站各抓各的：一个失败不影响另一个，错误记在 loadout_feeds。 */
export async function fetchLoadoutFeeds(deps: { fetch?: PageFetch; sleep?: (ms: number) => Promise<void>; now?: () => Date } = {}): Promise<Record<string, unknown>> {
  const fetchPage = deps.fetch ?? defaultFetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = deps.now ?? (() => new Date());
  const summary: Record<string, unknown> = {};
  for (const source of SOURCES) {
    try {
      const gathered = await source.gather(fetchPage, sleep);
      const fetchedAt = now();
      const counts = { inserted: 0, updated: 0, kept: 0, staleNoted: 0 };
      for (const row of gathered.rows) {
        const result = await saveFeedLoadout(sql, source.id, row, fetchedAt);
        counts[result] += 1;
      }
      counts.staleNoted = await noteStaleLoadouts(sql, source.id, gathered.stale);
      const note = summarize(source.name, gathered, counts);
      await recordFeedSuccess(sql, source.id, source.name, note);
      summary[source.id] = { ok: true, ...counts, stale: gathered.stale.length, ...gathered.rejected, byMode: gathered.byMode, unmapped: gathered.unmapped, warning: gathered.warning };
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
      await recordFeedFailure(sql, source.id, source.name, message);
      summary[source.id] = { ok: false, error: message };
    }
  }
  return summary;
}
