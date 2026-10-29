import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { matchWeapon } from "../catalog.ts";
import { decideLoadout, formatApplyCount } from "../codes.ts";
import { fetchLoadoutFeeds, gatherYunmaku, gatherYufan, type PageFetch } from "../fetch.ts";
import { SJZGQ_HOME, YUFAN_API_ORIGIN, YUFAN_ORIGIN, YUFAN_PAGE, YUFAN_ROW_CAP, YUNMAKU_ORIGIN, isPreferredAuthor, yufanAnonKey, yufanApiHeaders, yufanCodesUrl, yunmakuListUrl } from "../feeds.ts";
import { parseSjzgqCatalog, parseSjzgqHtml, sjzgqScriptUrl } from "../parse-sjzgq.ts";
import { parseYufan } from "../parse-yufan.ts";
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
    popularity: null,
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
    popularity: null,
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
    popularity: null,
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

test("the yufan anon key is the public client default unless overridden", () => {
  const key = yufanAnonKey({});
  const payload = JSON.parse(Buffer.from(key.split(".")[1]!, "base64url").toString("utf8")) as { role?: string; ref?: string };
  assert.equal(payload.role, "anon");
  assert.equal(payload.ref, "iugcmnqglxrcmdodugqk");
  assert.equal(yufanAnonKey({ YUFAN_SUPABASE_ANON_KEY: "  " }), key);
  assert.equal(yufanAnonKey({ YUFAN_SUPABASE_ANON_KEY: "replaced" }), "replaced");
  assert.equal(yufanApiHeaders({ YUFAN_SUPABASE_ANON_KEY: "replaced" }).Authorization, "Bearer replaced");
  assert.equal(formatApplyCount(863888), "应用 86.4万");
  assert.equal(formatApplyCount(50), "应用 50");
  assert.equal(formatApplyCount(null), null);
});

test("yufan official rows map the code, gun, author, price, popularity and Beijing sync date", () => {
  const parsed = parseYufan(fixture("yufan.json"), YUFAN_PAGE);
  assert.equal(parsed.rows, 12);
  const codes = parsed.raws.map((item) => item.code);
  assert.equal(codes.includes("Vector冲锋枪-全面战场-6HIDDENOFFICIAL1234"), false);
  assert.equal(codes.includes("AKM突击步枪-烽火地带-6CUSTOMSOURCE123456"), false);
  const byCode = new Map(parsed.raws.map((item) => [item.code.replace(/\s+/g, ""), item]));
  const hot = byCode.get("M250通用机枪-烽火地带-6LHR6VK04AP30SQDG0N2R");
  assert.equal(hot?.author, "鼠哈哈");
  assert.equal(hot?.priceText, "60.8万");
  assert.equal(hot?.popularity, 863888);
  assert.equal(hot?.postedOn, "2026-10-29");
  assert.equal(hot?.sourceUrl, YUFAN_PAGE);
  assert.equal(hot?.weaponHint, "M250通用机枪");
  const fallback = byCode.get("冲锋枪-烽火地带-6P90FALLBACK1234567");
  assert.equal(fallback?.weaponHint, "P90冲锋枪");
  const spaced = parsed.raws.find((item) => item.code.includes("6LEADSPACE123456789"));
  assert.equal(spaced?.author, "天霸Mad98");
  assert.equal(spaced?.priceText, null);
  assert.equal(spaced?.postedOn, "2026-10-29");
  const edge = byCode.get("M16A4突击步枪-烽火地带-6SEASONEDGE1234567");
  assert.equal(edge?.postedOn, "2026-09-04");
  const undated = byCode.get("G18-烽火地带-6NODATECODE12345678");
  assert.equal(undated?.postedOn, null);
  assert.equal(undated?.popularity, null);
  const decisions = parsed.raws.map((item) => decideLoadout(item));
  const accepted = decisions.filter((item) => item.ok);
  assert.equal(accepted.length, 7);
  const p90 = accepted.find((item) => item.ok && item.row.code.includes("6P90FALLBACK1234567"));
  assert.equal(p90 && p90.ok ? p90.row.weapon : "", "P90冲锋枪");
  assert.equal(decisions.filter((item) => !item.ok && item.reason === "stale").length, 1);
  assert.equal(decisions.filter((item) => !item.ok && item.reason === "shape").length, 1);
  assert.equal(decisions.filter((item) => !item.ok && item.reason === "unmapped").length, 1);
  assert.throws(() => parseYufan("{}", YUFAN_PAGE), /不是列表/);
  assert.throws(() => parseYufan("nope", YUFAN_PAGE), /不是 JSON/);
});

test("yufan reads both robots files, then requests the table with the anon key", async () => {
  const seen: Array<{ url: string; headers?: Record<string, string> }> = [];
  const body = fixture("yufan.json");
  const api = yufanCodesUrl();
  const fetchPage: PageFetch = async (url, init) => {
    seen.push({ url, headers: init?.headers });
    if (url === new URL("/robots.txt", YUFAN_ORIGIN).toString()) return { status: 200, text: () => "User-agent: *\nAllow: /\n" };
    if (url === new URL("/robots.txt", YUFAN_API_ORIGIN).toString()) return { status: 404, text: () => "{\"error\":\"requested path is invalid\"}" };
    if (url === api) return { status: 200, text: () => body };
    throw new Error(`unexpected ${url}`);
  };
  const gathered = await gatherYufan(fetchPage, async () => {});
  assert.deepEqual(seen.map((item) => item.url), [
    new URL("/robots.txt", YUFAN_ORIGIN).toString(),
    new URL("/robots.txt", YUFAN_API_ORIGIN).toString(),
    api,
  ]);
  assert.deepEqual(seen[2]?.headers, yufanApiHeaders());
  assert.equal(api.includes("source=eq.official"), true);
  assert.equal(api.includes("is_hidden=eq.false"), true);
  assert.equal(gathered.byMode["烽火地带"], 6);
  assert.equal(gathered.byMode["黑潮爆破"], 1);
  assert.deepEqual(gathered.unmapped, ["没这把枪"]);
  assert.equal(gathered.stale.length, 1);
  assert.equal(gathered.warning, null);
  assert.equal(gathered.rows.find((row) => row.code.startsWith("M250"))?.popularity, 863888);
});

test("yufan stops before the api when robots disallow it", async () => {
  const seen: string[] = [];
  const blockedSite: PageFetch = async (url) => {
    seen.push(url);
    return { status: 200, text: () => "User-agent: *\nDisallow: /\n" };
  };
  await assert.rejects(() => gatherYufan(blockedSite, async () => {}), /robots\.txt 不允许抓取有力气$/);
  assert.deepEqual(seen, [new URL("/robots.txt", YUFAN_ORIGIN).toString()]);

  const apiSeen: string[] = [];
  const blockedApi: PageFetch = async (url) => {
    apiSeen.push(url);
    if (url.startsWith(YUFAN_ORIGIN)) return { status: 200, text: () => "User-agent: *\nAllow: /\n" };
    return { status: 200, text: () => "User-agent: *\nDisallow: /rest/\n" };
  };
  await assert.rejects(() => gatherYufan(blockedApi, async () => {}), /改枪码接口/);
  assert.equal(apiSeen.includes(yufanCodesUrl()), false);
});

test("yufan warns when the official list fills the request cap", async () => {
  const rows = Array.from({ length: YUFAN_ROW_CAP }, (_, i) => ({
    source: "official",
    is_hidden: false,
    solution_code: `M250通用机枪-烽火地带-${i.toString(36).toUpperCase().padStart(12, "0")}`,
    arms_name: "M250通用机枪",
    author_nickname: "甲",
    price: 10000,
    apply_num: YUFAN_ROW_CAP - i,
    synced_at: "2026-10-29T00:30:00.000Z",
  }));
  const fetchPage: PageFetch = async (url) => {
    if (url.endsWith("/robots.txt") && url.startsWith(YUFAN_ORIGIN)) return { status: 200, text: () => "User-agent: *\nAllow: /\n" };
    if (url.endsWith("/robots.txt")) return { status: 404, text: () => "" };
    return { status: 200, text: () => JSON.stringify(rows) };
  };
  const gathered = await gatherYufan(fetchPage, async () => {});
  assert.match(gathered.warning ?? "", /1000/);
  assert.equal(gathered.rows.length, YUFAN_ROW_CAP);
  assert.equal(gathered.rows[0]?.popularity, YUFAN_ROW_CAP);
});

test("official hot codes sort ahead of streamers, and a repeated code stays with the first feed", async () => {
  await sql`DELETE FROM loadout_codes`;
  const at = new Date("2026-10-29T02:00:00+08:00");
  const official = {
    categoryKey: "lmg",
    weapon: "M250通用机枪",
    code: "M250通用机枪-烽火地带-6LHR6VK04AP30SQDG0N2R",
    mode: "烽火地带",
    priceText: "60.8万",
    author: "鼠哈哈",
    sourceUrl: YUFAN_PAGE,
    postedOn: "2026-10-29",
    popularity: 100,
  };
  assert.equal(await saveFeedLoadout(sql, "yufan", official, at), "inserted");
  assert.equal(await saveFeedLoadout(sql, "yufan", { ...official, popularity: 863888, priceText: "61万" }, at), "updated");
  assert.equal(await saveFeedLoadout(sql, "yunmaku", { ...official, author: "路人", popularity: 1, sourceUrl: "https://www.yunmaku.com/loadouts" }, at), "kept");
  await saveFeedLoadout(sql, "yufan", {
    ...official,
    code: "M250通用机枪-烽火地带-6HOTTEROLDER12345678",
    popularity: 50,
    author: "路人",
    postedOn: "2026-09-10",
  }, at);
  await saveFeedLoadout(sql, "sjzgq", {
    ...official,
    code: "M250通用机枪-烽火地带-6STREAMERCODE123456",
    author: "昊天",
    popularity: null,
    priceText: null,
    sourceUrl: "https://www.sjzgq.cn/",
    postedOn: "2026-10-20",
  }, at);
  await saveFeedLoadout(sql, "yunmaku", {
    ...official,
    code: "M250通用机枪-烽火地带-6PLAINNEWER12345678",
    author: "路人",
    popularity: null,
    sourceUrl: "https://www.yunmaku.com/loadouts",
    postedOn: "2026-10-28",
  }, at);
  const owned = "M250通用机枪-烽火地带-6OWNEDBYYUN12345678";
  assert.equal(await saveFeedLoadout(sql, "yunmaku", {
    ...official,
    code: owned,
    author: "路人",
    popularity: null,
    sourceUrl: "https://www.yunmaku.com/loadouts",
    postedOn: "2026-10-01",
  }, at), "inserted");
  assert.equal(await saveFeedLoadout(sql, "yufan", { ...official, code: owned, author: "官方作者", popularity: 99999 }, at), "kept");
  await saveFeedLoadout(sql, "yufan", {
    ...official,
    code: "M250通用机枪-烽火地带-6STALEHOTCODE123456",
    popularity: 20000,
    postedOn: "2026-08-01",
  }, at);

  const listed = await listLoadouts(sql);
  const codes = listed.categories.find((category) => category.key === "lmg")!.weapons.find((weapon) => weapon.name === "M250通用机枪")!.codes;
  assert.deepEqual(codes.map((item) => item.code), [
    official.code,
    "M250通用机枪-烽火地带-6HOTTEROLDER12345678",
    "M250通用机枪-烽火地带-6STREAMERCODE123456",
    "M250通用机枪-烽火地带-6PLAINNEWER12345678",
    owned,
    "M250通用机枪-烽火地带-6STALEHOTCODE123456",
  ]);
  assert.equal(codes[0]?.source, "有力气·官方热门");
  assert.equal(codes[0]?.author, "鼠哈哈");
  assert.equal(codes[0]?.priceText, "61万");
  assert.equal(codes[0]?.popularityText, "应用 86.4万");
  assert.equal(codes[0]?.featured, false);
  assert.equal(codes[1]?.popularityText, "应用 50");
  assert.equal(codes[2]?.featured, true);
  assert.equal(codes[2]?.source, "洲械库");
  assert.equal(codes[4]?.source, "云码库");
  assert.equal(codes[4]?.author, "路人");
  assert.equal(codes[5]?.stale, true);
  assert.equal(codes[5]?.popularityText, "应用 2万");
});

test("a fetch stores each feed and records a robots block without dropping the others", async () => {
  await sql`DELETE FROM loadout_codes`;
  await sql`DELETE FROM loadout_feeds`;
  const yunmaku = fixture("yunmaku.html");
  const sjzgq = fixture("sjzgq.html");
  const catalog = fixture("sjzgq-catalog.js");
  const robots = fixture("yunmaku-robots.txt");
  const yufan = fixture("yufan.json");
  const pages = new Map<string, { status: number; body: string }>([
    [new URL("/robots.txt", YUFAN_ORIGIN).toString(), { status: 200, body: "User-agent: *\nAllow: /\n" }],
    [new URL("/robots.txt", YUFAN_API_ORIGIN).toString(), { status: 404, body: "{\"error\":\"requested path is invalid\"}" }],
    [yufanCodesUrl(), { status: 200, body: yufan }],
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
  const yufanSummary = summary.yufan as { ok: boolean; inserted: number; byMode: Record<string, number>; unmapped: string[]; stale: number; warning: string | null };
  assert.equal(yun.ok, true);
  assert.equal(sj.ok, true);
  assert.equal(yufanSummary.ok, true);
  assert.equal(yufanSummary.inserted, 7);
  assert.equal(yufanSummary.stale, 1);
  assert.equal(yufanSummary.byMode["烽火地带"], 6);
  assert.equal(yufanSummary.byMode["黑潮爆破"], 1);
  assert.deepEqual(yufanSummary.unmapped, ["没这把枪"]);
  assert.equal(yufanSummary.warning, null);
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
  assert.ok(names.includes("M250通用机枪:有力气·官方热门:鼠哈哈"));
  assert.ok(names.includes("P90冲锋枪:有力气·官方热门:巾凡"));
  const [health] = await sql<{ health: string; last_error: string | null; note: string | null }[]>`SELECT health, last_error, note FROM loadout_feeds WHERE id = 'sjzgq'`;
  assert.equal(health?.health, "ok");
  assert.equal(health?.last_error, null);
  assert.match(health?.note ?? "", /洲械库/);

  pages.set(`${YUNMAKU_ORIGIN}/robots.txt`, { status: 200, body: "User-agent: *\nDisallow: /\n" });
  const blocked = await fetchLoadoutFeeds({ fetch: fetchPage, sleep: async () => {}, now: () => new Date("2026-10-28T02:00:00+08:00") });
  const blockedYun = blocked.yunmaku as { ok: boolean; error?: string };
  const blockedYufan = blocked.yufan as { ok: boolean };
  const blockedSj = blocked.sjzgq as { ok: boolean };
  assert.equal(blockedYun.ok, false);
  assert.equal(blockedYufan.ok, true);
  assert.equal(blockedSj.ok, true);
  assert.match(blockedYun.error ?? "", /robots\.txt/);
  const [failed] = await sql<{ health: string; fail_count: number }[]>`SELECT health, fail_count FROM loadout_feeds WHERE id = 'yunmaku'`;
  assert.equal(failed?.health, "degraded");
  assert.equal(failed?.fail_count, 1);
  const still = await listLoadouts(sql);
  const vector = still.categories.find((category) => category.key === "smg")!.weapons.find((weapon) => weapon.name === "Vector冲锋枪")!;
  assert.equal(vector.codes[0]?.author, "林树");
  const m250 = still.categories.find((category) => category.key === "lmg")!.weapons.find((weapon) => weapon.name === "M250通用机枪")!;
  assert.equal(m250.codes[0]?.source, "有力气·官方热门");
  assert.equal(m250.codes[0]?.author, "鼠哈哈");
  assert.equal(m250.codes[0]?.popularityText, "应用 86.4万");
});
