import type { FastifyInstance } from "fastify";
import { sql } from "@aihot/backend/db";
import { defineServerModule } from "@aihot/backend/modules";
import { GAME_ID, GAME_NAME, isWeaponListed, WEAPON_CATEGORIES } from "./catalog.ts";
import { loadoutDetail, priceLoadoutList, syncLoadoutDetails, syncLoadoutPrices } from "./detail.ts";
import { costsForLoadouts, loadoutCost, partialCoverage, syncMarketPrices } from "./prices.ts";
import { fetchAmsCodes, fetchDeltaCodes, fetchNssCodes, fetchWeaponTiers, fetchWeaponTtk } from "./ingest.ts";
import { fetchLoadoutFeeds } from "./fetch.ts";
import { cleanupOutOfSeason } from "./cleanup.ts";
import { BALANCE_SEASON_NOTE, feedEnabled } from "./feeds.ts";
import { currentSeason, detectSeason, seasonLabel, type StoredSeason } from "./season.ts";
import { gunPageCodes, gunSummary, parseLoadoutQuery, shapeLoadoutCategories } from "./query.ts";
import { listLoadouts, syncArticleLoadouts } from "./store.ts";
import { verifyLoadouts } from "./verify.ts";

function seasonNote(season: StoredSeason): string {
  const label = seasonLabel(season);
  const seasonLine = season.confidence === "certain"
    ? `当前赛季 ${label}，${season.startsOn} 起。更早的码会删掉，不留在这页。`
    : `赛季还没从官方公告确认，暂按 ${label}（${season.startsOn}）。没确认之前不会换季，也不会删码。`;
  return `来自官方热门、鸟兽兽、国服配装、云码库、洲械库，以及写明了枪名的文章。${seasonLine}点进一条可以看配件、最新价格和属性。对不上官方列表的社区码会标「待验证」。枪卡上的梯队和理论 TTK 是社区补充。${BALANCE_SEASON_NOTE} 价格以游戏内交易行为准。导入前请回游戏里核对。`;
}

export default defineServerModule({
  name: "loadouts",
  http(app: FastifyInstance) {
    app.get("/api/loadouts", async (req, reply) => {
      const game = typeof (req.query as { game?: unknown }).game === "string" ? (req.query as { game: string }).game : GAME_ID;
      const query = parseLoadoutQuery(new URL(req.url, "http://localhost").searchParams);
      reply.header("cache-control", "public, max-age=60");
      const season = await currentSeason(sql);
      const listed = await listLoadouts(sql, game === GAME_ID ? GAME_ID : game, null);
      const categories = await shapeLoadoutCategories(listed.categories, query, (rows) => priceLoadoutList(sql, rows));
      return {
        game: { id: GAME_ID, name: GAME_NAME },
        season: { name: season.name, number: season.number, startsOn: season.startsOn, label: seasonLabel(season), confidence: season.confidence },
        gameId: listed.gameId,
        categories,
        note: seasonNote(season),
      };
    });
    app.get("/api/loadouts/gun/:weapon", async (req, reply) => {
      const name = (req.params as { weapon: string }).weapon;
      const known = WEAPON_CATEGORIES.flatMap((category) => category.weapons.filter((weapon) => weapon.name === name && isWeaponListed(weapon)).map((weapon) => ({ key: category.key, label: category.label, weapon }))).at(0);
      if (!known) return reply.code(404).type("application/json").send({ error: "not_found" });
      const url = new URL(req.url, "http://localhost");
      const query = { ...parseLoadoutQuery(url.searchParams), category: null, tier: null };
      const listed = await listLoadouts(sql, GAME_ID, null);
      const narrowed = listed.categories
        .map((category) => ({ ...category, weapons: category.weapons.filter((weapon) => weapon.name === name) }))
        .filter((category) => category.weapons.length > 0);
      const neutral = { ...query, mode: null, source: null, q: "", pending: false, minPrice: null, maxPrice: null, sort: "popularity" as const };
      const priced = narrowed.length
        ? await shapeLoadoutCategories(narrowed, neutral, (rows) => priceLoadoutList(sql, rows), false)
        : [];
      const weapon = priced.flatMap((category) => category.weapons).find((item) => item.name === name) ?? narrowed[0]?.weapons[0];
      if (!weapon) return reply.code(404).type("application/json").send({ error: "not_found" });
      const listedCodes = gunPageCodes(weapon.codes, query);
      const costs = await costsForLoadouts(sql, listedCodes.map((code) => code.id));
      const requested = Number(url.searchParams.get("code"));
      const knownCode = Number.isSafeInteger(requested) && weapon.codes.some((code) => code.id === requested);
      const selected = knownCode ? await loadoutDetail(sql, requested) : null;
      reply.header("cache-control", "public, max-age=60");
      return {
        game: { id: GAME_ID, name: GAME_NAME },
        weapon: {
          name: weapon.name,
          categoryKey: known.key,
          categoryLabel: known.label,
          pic: weapon.pic,
          grade: weapon.grade,
          objectId: weapon.objectId,
          tier: weapon.tier,
          tierAsOf: weapon.tierAsOf,
          ttkText: weapon.ttkText,
          ttkNote: weapon.ttkNote,
          patchText: weapon.patchText,
          summary: gunSummary(weapon.codes),
          codes: listedCodes.map((code) => {
            const coverage = partialCoverage(costs.get(code.id), code.total);
            return coverage == null ? code : { ...code, coverage };
          }),
        },
        selected: selected && selected.code.weapon === name ? selected : null,
      };
    });
    app.get("/api/loadouts/:id/cost", async (req, reply) => {
      const id = Number((req.params as { id: string }).id);
      if (!Number.isSafeInteger(id) || id <= 0) return reply.code(404).type("application/json").send({ error: "not_found" });
      const cost = await loadoutCost(sql, id);
      if (!cost) return reply.code(404).type("application/json").send({ error: "not_found" });
      reply.header("cache-control", "public, max-age=60");
      return cost;
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
    {
      name: "loadouts.prices.catalog",
      // 枪和配件的全量目录。放在单件刷新之后，错过就等下一小时。
      cron: "25 * * * *",
      missed: "skip",
      when: () => feedEnabled("LOADOUT_PRICE_AMS_ENABLED"),
      run: () => syncMarketPrices(),
    },
    {
      name: "loadouts.fetch.ams",
      // 放在详情任务之前。约四十页，每页隔 1.2 秒。
      cron: "5 */6 * * *",
      missed: "skip",
      when: () => feedEnabled("LOADOUT_AMS_ENABLED"),
      run: () => fetchAmsCodes(),
    },
    {
      name: "loadouts.fetch.nss",
      // 页数多，和官方列表错开，每 6 小时一次。Crawl-delay 1 秒，实际隔 1.2 秒。
      cron: "15 1,7,13,19 * * *",
      missed: "skip",
      when: () => feedEnabled("LOADOUT_NSS_ENABLED"),
      run: () => fetchNssCodes(),
    },
    {
      name: "loadouts.fetch.deltacode",
      cron: "25 */12 * * *",
      missed: "skip",
      when: () => feedEnabled("LOADOUT_DELTACODE_ENABLED"),
      run: () => fetchDeltaCodes(),
    },
    {
      name: "loadouts.fetch.ttk",
      // 平衡数据随版本变，一天一次就够。
      cron: "40 5 * * *",
      missed: "skip",
      when: () => feedEnabled("LOADOUT_DFTTK_ENABLED"),
      run: () => fetchWeaponTtk(),
    },
    {
      name: "loadouts.fetch.tier",
      cron: "50 5 * * *",
      missed: "skip",
      when: () => feedEnabled("LOADOUT_TIER_ENABLED"),
      run: () => fetchWeaponTiers(),
    },
    {
      name: "loadouts.season",
      cron: "30 4 * * *",
      missed: "once",
      when: () => process.env.COLLECT_ENABLED === "true",
      run: () => detectSeason(),
    },
    {
      name: "loadouts.verify",
      cron: "20 5 * * *",
      missed: "skip",
      when: () => process.env.COLLECT_ENABLED === "true",
      run: () => verifyLoadouts(),
    },
    {
      name: "loadouts.cleanup",
      cron: "10 6 * * *",
      missed: "skip",
      when: () => process.env.COLLECT_ENABLED === "true",
      run: () => cleanupOutOfSeason(),
    },
  ],
  alerts: async () => {
    const rows = await sql<{ id: string; name: string; last_error: string | null; last_fetch_at: Date | null }[]>`
      SELECT id, name, last_error, last_fetch_at FROM loadout_feeds WHERE health = 'failing'`;
    return rows.map((row) => {
      const ams = row.id === "ams" || row.id === "ams-price" || row.id === "ams-catalog";
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
    pages: [`- [改枪码](/loadouts): 按《${GAME_NAME}》的枪种和枪名浏览改枪码。点开一把枪进入它自己的页面，可以看到全部方案、配件、最新价格和改装前后的属性`],
    api: [
      "- GET /api/loadouts — 改枪码，按枪种和枪名分组，带官方枪图、品质、作者、来源和整枪总价（价格齐了才有）。每把枪先筛选再最多留 40 条",
      "- GET /api/loadouts/gun/:weapon — 一把枪的全部方案。筛选和排序作用在截断之前，不按 40 条截断。`code` 带上选中方案的配件、单价和属性",
      "- GET /api/loadouts/:id — 一条改枪码的配件、单价、总价和属性",
      "- GET /api/loadouts/:id/cost — 这条码的枪身加已装配件的现价合计、覆盖率（0–100）和缺价的配件名。官方价优先于其他来源",
    ],
  }),
  sitemap: {
    entries: async () => [
      { loc: "/loadouts", changefreq: "hourly", priority: 0.7 },
      ...WEAPON_CATEGORIES.flatMap((category) => category.weapons.filter((weapon) => isWeaponListed(weapon)).map((weapon) => ({
        loc: `/loadouts/gun/${encodeURIComponent(weapon.name)}`,
        changefreq: "hourly",
        priority: 0.6,
      }))),
    ],
  },
});
