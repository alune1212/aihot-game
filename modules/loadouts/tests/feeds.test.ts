import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { matchWeapon } from "../catalog.ts";
import { decideLoadout } from "../codes.ts";
import { fetchLoadoutFeeds, gatherYunmaku, type PageFetch } from "../fetch.ts";
import { SJZGQ_HOME, YUNMAKU_ORIGIN, isPreferredAuthor, yunmakuListUrl } from "../feeds.ts";
import { parseSjzgqCatalog, parseSjzgqHtml, sjzgqScriptUrl } from "../parse-sjzgq.ts";
import { parseYunmaku } from "../parse-yunmaku.ts";
import { robotsAllows } from "../robots.ts";
import { listLoadouts, recordFeedFailure, saveFeedLoadout, syncArticleLoadouts } from "../store.ts";

const fixture = (name: string) => readFileSync(path.join(import.meta.dirname, "fixtures", name), "utf8");

after(closeDb);

test("weapon names and aliases map onto the official gun, and unknown names do not", () => {
  assert.equal(matchWeapon("K437突击步枪")?.weapon, "K437突击步枪");
  assert.equal(matchWeapon("M7")?.weapon, "M7战斗步枪");
  assert.equal(matchWeapon("M700")?.weapon, "M700狙击步枪");
  assert.equal(matchWeapon("M700狙击步枪")?.weapon, "M700狙击步枪");
  assert.equal(matchWeapon("HK416")?.weapon, "K416突击步枪");
  assert.equal(matchWeapon("MCX突击步枪")?.weapon, "MCX LT突击步枪");
  assert.equal(matchWeapon("SVCH射手步枪")?.weapon, "SVCH精确射手步枪");
  assert.equal(matchWeapon("Marlin射手步枪")?.weapon, "杠杆式步枪");
  assert.equal(matchWeapon("复合弓射手步枪")?.weapon, "复合弓");
  assert.equal(matchWeapon("QBZ95-1")?.categoryKey, "rifle");
  assert.equal(matchWeapon("霰弹枪"), null);
  assert.equal(matchWeapon("没这把枪"), null);
});

test("full CN codes are kept, tails and international codes are not, and dated codes follow the season", () => {
  const fresh = decideLoadout({
    code: "K416突击步枪-烽火地带-6FRESHCODE123456789",
    weaponHint: "K416",
    author: "昊天（三角洲行动）",
    priceText: "18.5W",
    postedOn: "2026-09-04",
    sourceUrl: "https://example.test/a",
  });
  assert.equal(fresh.ok, true);
  if (fresh.ok) {
    assert.equal(fresh.row.weapon, "K416突击步枪");
    assert.equal(fresh.row.mode, "烽火地带");
    assert.equal(fresh.row.postedOn, "2026-09-04");
  }
  assert.equal(isPreferredAuthor("昊天（三角洲行动）"), true);
  assert.equal(isPreferredAuthor("路人甲"), false);

  const dayBefore = decideLoadout({
    code: "M4A1突击步枪-烽火地带-6STALECODE123456789",
    weaponHint: null,
    author: null,
    priceText: null,
    postedOn: "2026-09-03",
    sourceUrl: "https://example.test/b",
  });
  assert.equal(dayBefore.ok, false);
  if (!dayBefore.ok) assert.equal(dayBefore.reason, "stale");

  const undated = decideLoadout({
    code: "Vector冲锋枪-全面战场-6HTMLONLY12345678",
    weaponHint: "Vector",
    author: null,
    priceText: "未标注",
    postedOn: null,
    sourceUrl: "https://example.test/c",
  });
  assert.equal(undated.ok, true);
  if (undated.ok) assert.equal(undated.row.priceText, null);

  for (const code of ["6IAIGQS09IA8FBVB7AGQU", "攻防均衡-BLAST6LEG9M007455B07A3ETOV"]) {
    const decision = decideLoadout({ code, weaponHint: null, author: null, priceText: null, postedOn: null, sourceUrl: "https://example.test" });
    assert.equal(decision.ok, false);
    if (!decision.ok) assert.equal(decision.reason, "shape");
  }
  const intl = decideLoadout({
    code: "M4A1突击步枪-烽火地带-OperationsABCDEF12",
    weaponHint: "M4A1",
    author: null,
    priceText: null,
    postedOn: "2026-10-01",
    sourceUrl: "https://example.test",
  });
  assert.equal(intl.ok, false);
  if (!intl.ok) assert.equal(intl.reason, "international");
  const unknown = decideLoadout({
    code: "没这把枪-烽火地带-6UNKNOWNGUN1234567",
    weaponHint: "没这把枪",
    author: null,
    priceText: null,
    postedOn: null,
    sourceUrl: "https://example.test",
  });
  assert.equal(unknown.ok, false);
  if (!unknown.ok) assert.equal(unknown.reason, "unmapped");
});

test("yunmaku robots allows the public list and blocks the api", () => {
  const body = fixture("yunmaku-robots.txt");
  const crawler = "GameHotBot/1.0";
  assert.equal(robotsAllows(body, "https://www.yunmaku.com/loadouts?mode=fenghuo&page=2", crawler), true);
  assert.equal(robotsAllows(body, "https://www.yunmaku.com/", crawler), true);
  assert.equal(robotsAllows(body, "https://www.yunmaku.com/api/copy-count.php", crawler), false);
  assert.equal(robotsAllows(body, "https://www.yunmaku.com/login.php", crawler), false);
  assert.equal(robotsAllows(body, "https://www.yunmaku.com/?action=export", crawler), false);
  assert.equal(robotsAllows(body, "https://www.yunmaku.com/database_anticrawl.sql", crawler), false);
});

test("yunmaku HTML keeps full codes with author, price and date, and still surfaces tails", () => {
  const found = parseYunmaku(fixture("yunmaku.html"), "https://www.yunmaku.com/loadouts?mode=fenghuo");
  const byCode = new Map(found.map((item) => [item.code, item]));
  const ptr = byCode.get("PTR-32突击步枪-全面战场-6KV8ADK04LFIB29M6GNGK");
  assert.ok(ptr);
  assert.equal(ptr.author, null);
  const fresh = byCode.get("K416突击步枪-烽火地带-6FRESHCODE123456789");
  assert.equal(fresh?.author, "昊天");
  assert.equal(fresh?.postedOn, "2026-09-11");
  assert.equal(fresh?.sourceUrl, "https://www.yunmaku.com/player.php?slug=%E6%98%8A%E5%A4%A9");
  const priced = byCode.get("6IAIGQS09IA8FBVB7AGQU");
  assert.equal(priced?.author, "天霸一霖");
  assert.equal(priced?.priceText, "18.5W");
  assert.equal(priced?.weaponHint, "R93狙击步枪");
  const decisions = found.map((item) => decideLoadout(item));
  const accepted = decisions.filter((item) => item.ok).map((item) => item.ok ? item.row.code : "");
  assert.ok(accepted.includes("PTR-32突击步枪-全面战场-6KV8ADK04LFIB29M6GNGK"));
  assert.ok(accepted.includes("K416突击步枪-烽火地带-6FRESHCODE123456789"));
  assert.equal(decisions.filter((item) => !item.ok && item.reason === "stale").length, 1);
  assert.equal(decisions.filter((item) => !item.ok && item.reason === "international").length, 1);
  assert.equal(decisions.filter((item) => !item.ok && item.reason === "shape").length, 2);
  assert.equal(decisions.filter((item) => !item.ok && item.reason === "unmapped").length, 1);
});

test("sjzgq catalog applies dates, hides removed ids, and the homepage HTML still parses", () => {
  const home = "https://www.sjzgq.cn/";
  const catalog = parseSjzgqCatalog(fixture("sjzgq-catalog.js"), home);
  const codes = new Map(catalog.map((item) => [item.code, item]));
  assert.equal(codes.has("M4A1突击步枪-烽火地带-6HIDDENCODE12345678"), false);
  const fresh = codes.get("K437突击步枪-烽火地带-6NEWCODE1234567890");
  assert.equal(fresh?.author, "昊天（三角洲行动）");
  assert.equal(fresh?.postedOn, "2026-09-11");
  assert.equal(fresh?.priceText, null);
  const overridden = codes.get("SR-25射手步枪-烽火地带-6OVRCODE12345678901");
  assert.equal(overridden?.postedOn, "2026-09-06");
  assert.equal(overridden?.priceText, "约 30 万");
  assert.equal(codes.get("M700狙击步枪-烽火地带-6OLDCODE12345678901")?.postedOn, "2026-08-01");
  assert.equal(sjzgqScriptUrl(fixture("sjzgq.html"), home), "https://www.sjzgq.cn/assets/page-test.js");
  assert.equal(sjzgqScriptUrl('<link rel="modulepreload" href="/assets/page-Ab12.js" />', home), "https://www.sjzgq.cn/assets/page-Ab12.js");
  const html = parseSjzgqHtml(fixture("sjzgq.html"), home);
  assert.equal(html.length, 1);
  assert.equal(html[0]?.author, "林树");
  assert.equal(html[0]?.postedOn, "2026-10-02");
  assert.equal(html[0]?.priceText, null);
  assert.equal(html[0]?.code, "Vector冲锋枪-全面战场-6HTMLONLY12345678");
  const kept = catalog.map((item) => decideLoadout(item)).filter((item) => item.ok);
  assert.deepEqual(kept.map((item) => item.ok ? item.row.weapon : "").sort(), ["K437突击步枪", "SR-25射手步枪"]);
});

test("yunmaku stops turning pages after a 403", async () => {
  const seen: string[] = [];
  const fetchPage: PageFetch = async (url) => {
    seen.push(url);
    if (url.endsWith("/robots.txt")) return { status: 200, text: () => "User-agent: *\nAllow: /\n" };
    return { status: 403, text: () => "no" };
  };
  await assert.rejects(() => gatherYunmaku(fetchPage, async () => {}), /HTTP 403/);
  assert.deepEqual(seen, [`${YUNMAKU_ORIGIN}/robots.txt`, `${YUNMAKU_ORIGIN}/`]);
});

test("the same code stays with the first feed, streamers sort first, and an article sync does not remove it", async () => {
  await sql`DELETE FROM loadout_codes`;
  await sql`DELETE FROM loadout_feeds`;
  const at = new Date("2026-10-28T00:00:00+08:00");
  const code = "K437突击步枪-烽火地带-6NEWCODE1234567890";
  const base = {
    categoryKey: "rifle",
    weapon: "K437突击步枪",
    code,
    mode: "烽火地带",
    priceText: null as string | null,
    author: "昊天（三角洲行动）",
    sourceUrl: "https://www.sjzgq.cn/",
    postedOn: "2026-09-11",
  };
  assert.equal(await saveFeedLoadout(sql, "sjzgq", base, at), "inserted");
  assert.equal(await saveFeedLoadout(sql, "yunmaku", { ...base, author: "路人", sourceUrl: "https://www.yunmaku.com/loadouts" }, at), "kept");
  assert.equal(await saveFeedLoadout(sql, "sjzgq", { ...base, priceText: "约 25 万" }, at), "updated");
  await saveFeedLoadout(sql, "yunmaku", {
    categoryKey: "rifle",
    weapon: "K437突击步枪",
    code: "K437突击步枪-烽火地带-6PLAINCODE123456789",
    mode: "烽火地带",
    priceText: null,
    author: "路人",
    sourceUrl: "https://www.yunmaku.com/loadouts",
    postedOn: "2026-10-01",
  }, at);
  await saveFeedLoadout(sql, "yunmaku", {
    categoryKey: "rifle",
    weapon: "K437突击步枪",
    code: "K437突击步枪-烽火地带-6OLDCODE12345678901",
    mode: "烽火地带",
    priceText: null,
    author: "昊天",
    sourceUrl: "https://www.yunmaku.com/loadouts",
    postedOn: "2026-08-01",
  }, at);

  const listed = await listLoadouts(sql);
  const codes = listed.categories.find((category) => category.key === "rifle")!.weapons.find((weapon) => weapon.name === "K437突击步枪")!.codes;
  assert.deepEqual(codes.map((item) => item.code), [
    "K437突击步枪-烽火地带-6NEWCODE1234567890",
    "K437突击步枪-烽火地带-6PLAINCODE123456789",
    "K437突击步枪-烽火地带-6OLDCODE12345678901",
  ]);
  assert.equal(codes[0]?.source, "洲械库");
  assert.equal(codes[0]?.author, "昊天（三角洲行动）");
  assert.equal(codes[0]?.priceText, "约 25 万");
  assert.equal(codes[0]?.featured, true);
  assert.equal(codes[0]?.postedOn, "2026-09-11");
  assert.equal(codes[2]?.stale, true);
  assert.equal(codes[2]?.featured, false);

  const id = `loadout-feed-${Date.now().toString(36)}`;
  await sql`INSERT INTO sources (id, name, kind, tier) VALUES (${id}, ${id}, 'rss', 'T1')`;
  await sql`INSERT INTO articles (id, source_id, identity_key, url, title, body_text, discovered_at, timeline_at, published_at)
    VALUES (${id}, ${id}, ${id}, ${`https://example.org/${id}`}, '改枪', ${"K437突击步枪 烽火地带 分享码：6NEWCODE1234567890"}, now(), now(), now())`;
  await syncArticleLoadouts(sql, id, false);
  await syncArticleLoadouts(sql, id, true);
  const after = await listLoadouts(sql);
  const still = after.categories.find((category) => category.key === "rifle")!.weapons.find((weapon) => weapon.name === "K437突击步枪")!.codes;
  assert.equal(still[0]?.code, code);
  assert.equal(still[0]?.source, "洲械库");

  await recordFeedFailure(sql, "yunmaku", "云码库", "HTTP 503");
  const [once] = await sql<{ health: string; fail_count: number }[]>`SELECT health, fail_count FROM loadout_feeds WHERE id = 'yunmaku'`;
  assert.equal(once?.health, "degraded");
  assert.equal(once?.fail_count, 1);
  for (let n = 0; n < 4; n++) await recordFeedFailure(sql, "yunmaku", "云码库", "HTTP 503");
  const [failing] = await sql<{ health: string; fail_count: number }[]>`SELECT health, fail_count FROM loadout_feeds WHERE id = 'yunmaku'`;
  assert.equal(failing?.health, "failing");
  assert.equal(failing?.fail_count, 5);
});

test("a fetch stores both feeds and records a robots block without dropping the other", async () => {
  await sql`DELETE FROM loadout_codes`;
  await sql`DELETE FROM loadout_feeds`;
  const yunmaku = fixture("yunmaku.html");
  const sjzgq = fixture("sjzgq.html");
  const catalog = fixture("sjzgq-catalog.js");
  const robots = fixture("yunmaku-robots.txt");
  const pages = new Map<string, { status: number; body: string }>([
    [`${YUNMAKU_ORIGIN}/robots.txt`, { status: 200, body: robots }],
    [`${YUNMAKU_ORIGIN}/`, { status: 200, body: yunmaku }],
    [yunmakuListUrl("fenghuo"), { status: 200, body: yunmaku }],
    [yunmakuListUrl("battlefield"), { status: 200, body: yunmaku }],
    [yunmakuListUrl("heichao"), { status: 200, body: yunmaku }],
    [new URL("/robots.txt", SJZGQ_HOME).toString(), { status: 200, body: "<!DOCTYPE html><html><title>not robots</title></html>" }],
    [SJZGQ_HOME, { status: 200, body: sjzgq }],
    [new URL("/assets/page-test.js", SJZGQ_HOME).toString(), { status: 200, body: catalog }],
  ]);
  const fetchPage: PageFetch = async (url) => {
    const hit = pages.get(url);
    if (!hit) throw new Error(`unexpected ${url}`);
    return { status: hit.status, text: () => hit.body };
  };
  const summary = await fetchLoadoutFeeds({ fetch: fetchPage, sleep: async () => {}, now: () => new Date("2026-10-28T01:00:00+08:00") });
  const yun = summary.yunmaku as { ok: boolean; byMode: Record<string, number>; unmapped: string[] };
  const sj = summary.sjzgq as { ok: boolean; byMode: Record<string, number>; unmapped: string[] };
  assert.equal(yun.ok, true);
  assert.equal(sj.ok, true);
  assert.equal(yun.byMode["烽火地带"], 1);
  assert.equal(yun.byMode["全面战场"], 1);
  assert.deepEqual(yun.unmapped, ["没这把枪"]);
  assert.equal(sj.byMode["烽火地带"], 2);
  assert.equal(sj.byMode["全面战场"], 1);
  assert.ok(sj.unmapped.includes("霰弹枪"));
  const listed = await listLoadouts(sql);
  const names = listed.categories.flatMap((category) => category.weapons.flatMap((weapon) => weapon.codes.map((code) => `${weapon.name}:${code.source}:${code.author ?? ""}`)));
  assert.ok(names.includes("K437突击步枪:洲械库:昊天（三角洲行动）"));
  assert.ok(names.includes("Vector冲锋枪:洲械库:林树"));
  assert.ok(names.some((name) => name.startsWith("K416突击步枪:云码库:昊天")));
  const [health] = await sql<{ health: string; last_error: string | null; note: string | null }[]>`SELECT health, last_error, note FROM loadout_feeds WHERE id = 'sjzgq'`;
  assert.equal(health?.health, "ok");
  assert.equal(health?.last_error, null);
  assert.match(health?.note ?? "", /洲械库/);

  pages.set(`${YUNMAKU_ORIGIN}/robots.txt`, { status: 200, body: "User-agent: *\nDisallow: /\n" });
  const blocked = await fetchLoadoutFeeds({ fetch: fetchPage, sleep: async () => {}, now: () => new Date("2026-10-28T02:00:00+08:00") });
  const blockedYun = blocked.yunmaku as { ok: boolean; error?: string };
  assert.equal(blockedYun.ok, false);
  assert.match(blockedYun.error ?? "", /robots\.txt/);
  const [failed] = await sql<{ health: string; fail_count: number }[]>`SELECT health, fail_count FROM loadout_feeds WHERE id = 'yunmaku'`;
  assert.equal(failed?.health, "degraded");
  assert.equal(failed?.fail_count, 1);
  const still = await listLoadouts(sql);
  const vector = still.categories.find((category) => category.key === "smg")!.weapons.find((weapon) => weapon.name === "Vector冲锋枪")!;
  assert.equal(vector.codes[0]?.author, "林树");
});
