// 改枪码聚合站、赛季日、优先主播。改这里即可，不用改抓取逻辑。
// 下一季「微光」2026-11-05 开始：把 SEASON_START 改成那一天。已经入库、发布日更早的码仍留着，
// 页面标成过季并排到后面，不会当成当前方案。

/** 当前国服赛季开始日（北京时间，含当天）。有发布日、早于这一天的码不新收录。 */
export const SEASON_START = "2026-09-04";

/**
 * 这些作者的方案在 /loadouts 里排在同枪其他方案前面，并标「主播」。
 * 用包含关系匹配，所以「昊天」对得上「昊天（三角洲行动）」。
 */
export const PREFERRED_STREAMERS = ["Always聪聪", "昊天", "林树", "成成大王", "bbFPS", "Mad98"] as const;

export const YUNMAKU_ORIGIN = "https://www.yunmaku.com";
export const SJZGQ_HOME = "https://www.sjzgq.cn/";

/** 云码库列表的模式参数。heichao_loadout 是国际服 BLAST 码，国服导不进去，不抓。 */
export const YUNMAKU_MODES = ["fenghuo", "battlefield", "heichao"] as const;

export const FEED_LABEL: Record<string, string> = {
  yunmaku: "云码库",
  sjzgq: "洲械库",
};

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
