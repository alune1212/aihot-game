import type { FastifyInstance } from "fastify";
import { sql } from "@aihot/backend/db";
import { defineServerModule } from "@aihot/backend/modules";
import { GAME_ID, GAME_NAME } from "./catalog.ts";
import { loadoutDetail, priceLoadoutList, syncLoadoutDetails, syncLoadoutPrices } from "./detail.ts";
import { fetchLoadoutFeeds } from "./fetch.ts";
import { SEASON_START } from "./feeds.ts";
import { listLoadouts, syncArticleLoadouts } from "./store.ts";

const note = `来自官方热门、云码库、洲械库，以及写明了枪名的文章。早于 ${SEASON_START} 的不新收录，换季后更早的码会标成过季。点进一条可以看配件、最新价格和属性。价格以游戏内交易行为准。导入前请回游戏里核对。`;

export default defineServerModule({
  name: "loadouts",
  http(app: FastifyInstance) {
    app.get("/api/loadouts", async (req, reply) => {
      const game = typeof (req.query as { game?: unknown }).game === "string" ? (req.query as { game: string }).game : GAME_ID;
      reply.header("cache-control", "public, max-age=60");
      const listed = await listLoadouts(sql, game === GAME_ID ? GAME_ID : game);
      return {
        game: { id: GAME_ID, name: GAME_NAME },
        ...listed,
        categories: await priceLoadoutList(sql, listed.categories),
        note,
      };
    });
    app.get("/api/loadouts/:id", async (req, reply) => {
      const id = Number((req.params as { id: string }).id);
      if (!Number.isSafeInteger(id) || id <= 0) return reply.code(404).type("application/json").send({ error: "not_found" });
      const row = await loadoutDetail(sql, id);
      if (!row) return reply.code(404).type("application/json").send({ error: "not_found" });
      reply.header("cache-control", "public, max-age=60");
      return { game: { id: GAME_ID, name: GAME_NAME }, ...row };
    });
  },
  schedules: [
    {
      name: "loadouts.fetch",
      // 上海时间每 6 小时一次，错开整点。错过的一轮跳过，下一轮再抓。
      cron: "20 */6 * * *",
      missed: "skip",
      when: () => process.env.COLLECT_ENABLED === "true",
      run: () => fetchLoadoutFeeds(),
    },
    {
      name: "loadouts.detail",
      // 官方方案列表大约四十页。放在抓码之后，错过就等下一次。
      cron: "40 */6 * * *",
      missed: "skip",
      when: () => process.env.COLLECT_ENABLED === "true",
      run: () => syncLoadoutDetails(),
    },
    {
      name: "loadouts.prices",
      // 交易行价格一小时一次，和方案详情错开。
      cron: "15 * * * *",
      missed: "skip",
      when: () => process.env.COLLECT_ENABLED === "true",
      run: () => syncLoadoutPrices(),
    },
  ],
  alerts: async () => {
    const rows = await sql<{ id: string; name: string; last_error: string | null; last_fetch_at: Date | null }[]>`
      SELECT id, name, last_error, last_fetch_at FROM loadout_feeds WHERE health = 'failing'`;
    return rows.map((row) => {
      const ams = row.id === "ams" || row.id === "ams-price";
      return {
        key: `loadouts.${row.id}`,
        level: "today" as const,
        title: ams ? `${row.name}暂时不可用` : `${row.name}的改枪码抓取失败`,
        impact: ams ? "已缓存的官方详情和价格继续显示，还没缓存过的码显示暂无官方详情" : "改枪码页会少掉这个站上的新方案",
        heals: ams ? "官方接口恢复后，下一次任务会自己好" : "站点恢复后，下一次定时抓取会自己好",
        action: ams ? "看任务 loadouts.detail 或 loadouts.prices 的错误" : "看任务 loadouts.fetch 的错误",
        detail: row.last_error ?? "",
        since: row.last_fetch_at ?? undefined,
      };
    });
  },
  sourceHealth: async () => {
    const rows = await sql<{ name: string; health: string; last_error: string | null; note: string | null }[]>`
      SELECT name, health, last_error, note FROM loadout_feeds ORDER BY id`;
    return rows.map((row) => {
      const state = row.health === "ok" ? "正常" : row.health === "failing" ? "连续失败" : "最近一次失败";
      return `改枪码·${row.name}：${state}${row.last_error ? `（${row.last_error}）` : ""}${row.note ? `。${row.note}` : ""}`;
    });
  },
  on: {
    articleChanged: async (change, tx) => {
      await syncArticleLoadouts(tx, change.id, change.reduced === true);
    },
  },
  llms: () => ({
    pages: [`- [改枪码](/loadouts): 按《${GAME_NAME}》的枪种和枪名浏览改枪码。点进一条可以看到配件、最新价格和改装前后的属性`],
    api: [
      "- GET /api/loadouts — 改枪码，按枪种和枪名分组，带作者、来源和整枪总价（价格齐了才有）",
      "- GET /api/loadouts/:id — 一条改枪码的配件、单价、总价和属性",
    ],
  }),
  sitemap: {
    entries: async () => [{ loc: "/loadouts", changefreq: "hourly", priority: 0.7 }],
  },
});
