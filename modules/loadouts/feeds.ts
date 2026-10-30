// 改枪码聚合站、赛季日、优先主播。改这里即可，不用改抓取逻辑。
// 下一季「微光」2026-11-05 开始：把 SEASON_START 改成那一天。已经入库、发布日更早的码仍留着，
// 页面标成过季并排到后面，不会当成当前方案。

/** 当前国服赛季开始日（北京时间，含当天）。有发布日、早于这一天的码不新收录。 */
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

export const FEED_LABEL: Record<string, string> = {
  yunmaku: "云码库",
  sjzgq: "洲械库",
  [OFFICIAL_FEED_ID]: "官方热门",
};

/** 读者看到的来源。官方热门不链到采集站；库里的旧链接在这里丢掉。 */
export function publicFeed(source: string | null, sourceUrl: string | null): { source: string | null; sourceUrl: string | null } {
  if (!source) return { source: null, sourceUrl };
  if (source === OFFICIAL_FEED_ID) return { source: FEED_LABEL[source]!, sourceUrl: null };
  return { source: FEED_LABEL[source] ?? source, sourceUrl };
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
