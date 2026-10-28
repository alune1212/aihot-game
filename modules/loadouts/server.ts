import type { FastifyInstance } from "fastify";
import { sql } from "@aihot/backend/db";
import { defineServerModule } from "@aihot/backend/modules";
import { GAME_ID, GAME_NAME } from "./catalog.ts";
import { fetchLoadoutFeeds } from "./fetch.ts";
import { SEASON_START } from "./feeds.ts";
import { listLoadouts, syncArticleLoadouts } from "./store.ts";

const note = `来自云码库、洲械库，以及写明了枪名的文章。早于 ${SEASON_START} 的不新收录，换季后更早的码会标成过季。导入前请回游戏里核对。`;

export default defineServerModule({
  name: "loadouts",
  http(app: FastifyInstance) {
    app.get("/api/loadouts", async (req, reply) => {
      const game = typeof (req.query as { game?: unknown }).game === "string" ? (req.query as { game: string }).game : GAME_ID;
      reply.header("cache-control", "public, max-age=60");
      return {
        game: { id: GAME_ID, name: GAME_NAME },
        ...(await listLoadouts(sql, game === GAME_ID ? GAME_ID : game)),
        note,
      };
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
  ],
  alerts: async () => {
    const rows = await sql<{ id: string; name: string; last_error: string | null; last_fetch_at: Date | null }[]>`
      SELECT id, name, last_error, last_fetch_at FROM loadout_feeds WHERE health = 'failing'`;
    return rows.map((row) => ({
      key: `loadouts.${row.id}`,
      level: "today" as const,
      title: `${row.name}的改枪码抓取失败`,
      impact: "改枪码页会少掉这个站上的新方案",
      heals: "站点恢复后，下一次定时抓取会自己好",
      action: "看任务 loadouts.fetch 的错误",
      detail: row.last_error ?? "",
      since: row.last_fetch_at ?? undefined,
    }));
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
    pages: [`- [改枪码](/loadouts): 按《${GAME_NAME}》的枪种和枪名浏览改枪码，来自云码库、洲械库和已采集文章`],
    api: ["- GET /api/loadouts — 改枪码，按枪种和枪名分组，带作者和来源"],
  }),
  sitemap: {
    entries: async () => [{ loc: "/loadouts", changefreq: "hourly", priority: 0.7 }],
  },
});
