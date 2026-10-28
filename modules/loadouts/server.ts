import type { FastifyInstance } from "fastify";
import { sql } from "@aihot/backend/db";
import { defineServerModule } from "@aihot/backend/modules";
import { GAME_ID, GAME_NAME } from "./catalog.ts";
import { listLoadouts, syncArticleLoadouts } from "./store.ts";

export default defineServerModule({
  name: "loadouts",
  http(app: FastifyInstance) {
    app.get("/api/loadouts", async (req, reply) => {
      const game = typeof (req.query as { game?: unknown }).game === "string" ? (req.query as { game: string }).game : GAME_ID;
      reply.header("cache-control", "public, max-age=60");
      return {
        game: { id: GAME_ID, name: GAME_NAME },
        ...(await listLoadouts(sql, game === GAME_ID ? GAME_ID : game)),
        note: "改枪码从已采集文章里抽取：正文要同时写明枪名，以及「改枪码」「方案码」或「分享码」。官方微信小程序里的方案没有公开接口，这里不会自动出现。",
      };
    });
  },
  on: {
    articleChanged: async (change, tx) => {
      await syncArticleLoadouts(tx, change.id, change.reduced === true);
    },
  },
  llms: () => ({
    pages: [`- [改枪码](/loadouts): 按《${GAME_NAME}》的枪种和枪名浏览从文章里抽出的改枪码`],
    api: ["- GET /api/loadouts — 改枪码，按枪种和枪名分组"],
  }),
  sitemap: {
    entries: async () => [{ loc: "/loadouts", changefreq: "hourly", priority: 0.7 }],
  },
});
