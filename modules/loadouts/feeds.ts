// 改枪码聚合站、优先主播。赛季日由 season.ts 从官方公告写入 loadout_seasons。
// SEASON_START 只是还没确认时的底：S11「群星」2026-09-04。确认了新赛季以后，收录和清理用库里的开季日。

/** 还没从官方公告确认赛季时用的开季日（北京时间，含当天）。不要手改着换季。 */
export const SEASON_START = "2026-09-04";

/**
 * 这些作者的方案在 /loadouts 里排在同枪其他方案前面，并标「主播」。
 * 有力气的官方热门还要再靠前（见 store.ts）。
 * 用包含关系匹配，所以「昊天」对得上「昊天（三角洲行动）」。
 */
export const PREFERRED_STREAMERS = ["Always聪聪", "昊天", "林树", "成成大王", "bbFPS", "Mad98"] as const;

export const YUNMAKU_ORIGIN = "https://www.yunmaku.com";
export const SJZGQ_HOME = "https://www.sjzgq.cn/";

/** 有力气改枪站。官方热门列表在 /official，数据在下面的 Supabase 公开表。 */
export const YUFAN_ORIGIN = "https://guns.yufantechs.com";
export const YUFAN_PAGE = `${YUFAN_ORIGIN}/official`;
export const YUFAN_API_ORIGIN = "https://iugcmnqglxrcmdodugqk.supabase.co";
/** 这个源在 loadout_codes.source / loadout_feeds.id 里的名字。同枪列表里排在主播前面。 */
export const OFFICIAL_FEED_ID = "yufan";
/** 官方改枪台方案列表。读者看到的名字和有力气一样，都是「官方热门」。 */
export const AMS_FEED_ID = "ams-list";
export const NSS_FEED_ID = "nss";
export const DELTACODE_FEED_ID = "deltacode";
export const DFTTK_FEED_ID = "dfttk";
export const TIER_FEED_ID = "congcong";

export const NSS_ORIGIN = "https://nss.seoml.com";
export const DELTACODE_ORIGIN = "https://delta-code.cn";
export const DELTACODE_PAGE = `${DELTACODE_ORIGIN}/loadouts`;
export const DFTTK_ORIGIN = "https://dfttk.com";
export const DFTTK_MANIFEST = `${DFTTK_ORIGIN}/data/v3/manifest.json`;
export const TIER_PAGE = "https://www.dfgqm.com/tier-list";

/** 社区补充的说明。下一季「微光」从 2026-11-05 开始，梯队和理论 TTK 都可能过时。 */
export const BALANCE_SEASON_NOTE = "聪聪梯队是社区排名，不是官方。理论 TTK 来自 DFTTK，按它公开的护甲、弹药和命中分布估算。下一季「微光」从 2026-11-05 开始，这两项都可能不再对应当前赛季。";
/**
 * shortcut: 官方热门现在约 100 条。PostgREST 一次最多收这么多，到顶就在 note 里警告。
 * 超过时再改成按 apply_num 翻页。
 */
export const YUFAN_ROW_CAP = 1000;

/**
 * 有力气前端包里的公开 anon key（JWT role=anon，到 2036 年）。不是密钥，页面自己就会带上它。
 * 不在运行时再去扒脚本：包文件名会变，而这把 key 是项目级的、写在前端里给浏览器用。
 * 对方轮换后设 YUFAN_SUPABASE_ANON_KEY 盖掉这里。
 */
export const YUFAN_ANON_KEY_DEFAULT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml1Z2NtbnFnbHhyY21kb2R1Z3FrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0MzU5NTYsImV4cCI6MjA4ODAxMTk1Nn0.4nBwFJPg4KJha7L3oRnvjxzHRlLD51-HH2Js4Mcp_SI";

export function yufanAnonKey(env: { YUFAN_SUPABASE_ANON_KEY?: string } = process.env): string {
  const fromEnv = env.YUFAN_SUPABASE_ANON_KEY?.trim();
  return fromEnv || YUFAN_ANON_KEY_DEFAULT;
}

export function yufanApiHeaders(env: { YUFAN_SUPABASE_ANON_KEY?: string } = process.env): Record<string, string> {
  const key = yufanAnonKey(env);
  return { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" };
}

/** 官方热门。source=official 且未下架，按应用次数从高到低。 */
export function yufanCodesUrl(): string {
  const query = [
    "source=eq.official",
    "is_hidden=eq.false",
    "select=*",
    "order=apply_num.desc",
    `limit=${YUFAN_ROW_CAP}`,
  ].join("&");
  return `${YUFAN_API_ORIGIN}/rest/v1/official_gun_codes?${query}`;
}

/** 云码库列表的模式参数。heichao_loadout 是国际服 BLAST 码，国服导不进去，不抓。 */
export const YUNMAKU_MODES = ["fenghuo", "battlefield", "heichao"] as const;

/** 官方来源排在社区来源前面。社区来源之间不互相覆盖，仍是先到先得。 */
const SOURCE_RANK: Record<string, number> = {
  [AMS_FEED_ID]: 0,
  [OFFICIAL_FEED_ID]: 1,
  [DELTACODE_FEED_ID]: 2,
  [NSS_FEED_ID]: 3,
  yunmaku: 4,
  sjzgq: 5,
};

export const FEED_LABEL: Record<string, string> = {
  yunmaku: "云码库",
  sjzgq: "洲械库",
  [OFFICIAL_FEED_ID]: "官方热门",
  [AMS_FEED_ID]: "官方热门",
  [NSS_FEED_ID]: "鸟兽兽",
  [DELTACODE_FEED_ID]: "国服配装",
};

export function isOfficialSource(source: string | null | undefined): boolean {
  return source === OFFICIAL_FEED_ID || source === AMS_FEED_ID;
}

/**
 * 后来的来源能不能改这条码的作者、热度和主来源。
 * 官方可以盖过社区。两条官方里，改枪台列表盖过热门镜像。社区之间不改。
 * 还没有来源的（文章抽出的码）谁先写入聚合来源谁就占上。
 */
export function sourceOutranks(incoming: string, existing: string | null): boolean {
  if (!existing || existing === incoming) return true;
  if (!isOfficialSource(incoming)) return false;
  if (!isOfficialSource(existing)) return true;
  return (SOURCE_RANK[incoming] ?? 9) < (SOURCE_RANK[existing] ?? 9);
}

/** 采集总开关加上这一源自己的开关。两个都要是 true。 */
export function feedEnabled(flag: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return env.COLLECT_ENABLED === "true" && env[flag] === "true";
}

export interface ShownSource {
  label: string;
  url: string | null;
}

/** 读者看到的来源。官方热门不链到采集站；库里的旧链接在这里丢掉。 */
export function publicFeed(source: string | null, sourceUrl: string | null): { source: string | null; sourceUrl: string | null } {
  if (!source) return { source: null, sourceUrl };
  if (isOfficialSource(source)) return { source: "官方热门", sourceUrl: null };
  return { source: FEED_LABEL[source] ?? source, sourceUrl };
}

/** 主来源排在最前。两个官方来源合并成一个「官方热门」。 */
export function presentSources(
  primary: string | null,
  primaryUrl: string | null,
  rows: readonly { source: string; sourceUrl: string | null }[],
): ShownSource[] {
  const list = rows.length ? [...rows] : (primary ? [{ source: primary, sourceUrl: primaryUrl }] : []);
  list.sort((a, b) => {
    if (a.source === primary && b.source !== primary) return -1;
    if (b.source === primary && a.source !== primary) return 1;
    return (SOURCE_RANK[a.source] ?? 9) - (SOURCE_RANK[b.source] ?? 9);
  });
  const out: ShownSource[] = [];
  const seen = new Set<string>();
  for (const row of list) {
    const shown = publicFeed(row.source, row.sourceUrl);
    if (!shown.source || seen.has(shown.source)) continue;
    seen.add(shown.source);
    out.push({ label: shown.source, url: shown.sourceUrl });
  }
  return out;
}

export function nssGunUrl(page = 1): string {
  const url = new URL("/gun", NSS_ORIGIN);
  if (page > 1) url.searchParams.set("page", String(page));
  return url.toString();
}

/** 同一把枪的列表里，主播方案靠前。 */
export function isPreferredAuthor(author: string | null | undefined): boolean {
  if (!author) return false;
  const name = author.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
  return PREFERRED_STREAMERS.some((streamer) => name.includes(streamer.normalize("NFKC").toLowerCase().replace(/\s+/g, "")));
}

export function yunmakuListUrl(mode: string, page = 1): string {
  const url = new URL("/loadouts", YUNMAKU_ORIGIN);
  url.searchParams.set("mode", mode);
  if (page > 1) url.searchParams.set("page", String(page));
  return url.toString();
}
