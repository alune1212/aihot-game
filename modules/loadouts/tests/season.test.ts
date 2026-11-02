// 赛季只认官方公告标题里的名字和开季日。清理在不确定、抓取失败或新码太少时不删。
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { beijingMidnight } from "@aihot/contracts/time";
import { planCleanup, cleanupOutOfSeason } from "../cleanup.ts";
import { decodeLoadoutCode } from "../decode.ts";
import { decideLoadout } from "../codes.ts";
import { dropBareYunmaku, listLoadouts, saveFeedLoadout } from "../store.ts";
import { consistentSeasons, currentSeason, detectSeason, parseSeasonAnnouncement } from "../season.ts";
import { judgeVerification } from "../verify.ts";

after(closeDb);

const glare = "11月5日全新「微光」赛季开启，《三角洲行动》x《影之刃零》联动活动同步登场！";
const stars = "9月4日更新公告丨新赛季【群星】即将开启！";

test("official titles with one season name and one start date are seasons", () => {
  assert.deepEqual(parseSeasonAnnouncement({ title: glare, publishedOn: "2026-10-31" }), {
    name: "微光",
    number: null,
    startsOn: "2026-11-05",
    evidence: glare,
  });
  assert.deepEqual(parseSeasonAnnouncement({ title: stars, publishedOn: "2026-09-02" }), {
    name: "群星",
    number: null,
    startsOn: "2026-09-04",
    evidence: stars,
  });
  assert.equal(parseSeasonAnnouncement({ title: "新赛季“微光”PC版本预更新安排说明", publishedOn: "2026-10-30" }), null);
  assert.equal(parseSeasonAnnouncement({ title: "10月29日更新公告|微光时刻将至!", publishedOn: "2026-10-28" }), null);
  assert.equal(parseSeasonAnnouncement({ title: "S12「微光」赛季 11月5日开启，也写了 12月1日开启", publishedOn: "2026-10-31" }), null);
});

test("two dates for one season name are rejected instead of advancing", () => {
  const { seasons, rejected } = consistentSeasons([
    { name: "微光", number: null, startsOn: "2026-11-05", evidence: "a" },
    { name: "微光", number: 12, startsOn: "2026-11-06", evidence: "b" },
    { name: "群星", number: 11, startsOn: "2026-09-04", evidence: "c" },
  ]);
  assert.deepEqual(rejected, ["微光"]);
  assert.deepEqual(seasons.map((season) => season.name), ["群星"]);
});

test("a stored announcement becomes the current season only after its start date", async () => {
  await sql`INSERT INTO sources (id, name, kind, tier) VALUES ('df-official-news', '官网新闻', 'json_list', 'T1') ON CONFLICT (id) DO NOTHING`;
  const id = `season-${Date.now().toString(36)}`;
  await sql`INSERT INTO articles (id, source_id, identity_key, url, title, discovered_at, timeline_at, published_at)
    VALUES (${id}, 'df-official-news', ${id}, ${`https://df.qq.com/${id}`}, ${glare}, '2026-10-31T05:00:00Z', '2026-10-31T05:00:00Z', '2026-10-31T05:47:00Z')`;
  const detected = await detectSeason({ db: sql, now: new Date("2026-11-02T02:00:00Z"), fetch: async () => { throw new Error("no network"); } });
  assert.equal(detected.ok, false);
  assert.equal((await currentSeason(sql, "2026-11-02")).confidence, "uncertain");
  const started = await currentSeason(sql, "2026-11-05");
  assert.equal(started.name, "微光");
  assert.equal(started.startsOn, "2026-11-05");
  assert.equal(started.confidence, "certain");
  let called = false;
  const again = await detectSeason({
    db: sql,
    now: new Date("2026-11-06T02:00:00Z"),
    fetch: async () => { called = true; return { status: 500, text: "" }; },
  });
  assert.equal(called, false);
  assert.equal(again.current.name, "微光");
});

test("cleanup refuses an uncertain season, a failed fetch, and a thin new season", () => {
  const codes = [{ id: 1, source: "nss", sources: ["nss"], postedOn: "2026-08-01", fetchedOn: "2026-08-01", onOfficialList: null }];
  const base = { seasonStart: "2026-11-05", dryRun: false, max: 10, minFresh: 2, fresh: 5, listKnown: true, codes };
  assert.match(planCleanup({ ...base, seasonCertain: false, fetchFailed: false }).skipped ?? "", /没有确认/);
  assert.match(planCleanup({ ...base, seasonCertain: true, fetchFailed: true }).skipped ?? "", /抓取失败/);
  assert.match(planCleanup({ ...base, seasonCertain: true, fetchFailed: false, fresh: 1 }).skipped ?? "", /少于/);
  const plan = planCleanup({ ...base, seasonCertain: true, fetchFailed: false });
  assert.deepEqual(plan.ids, [1]);
  assert.equal(plan.bySource.nss, 1);
});

test("official codes still on the list stay, absent ones from the previous season go", () => {
  const kept = { id: 2, source: "ams-list", sources: ["ams-list"], postedOn: "2026-09-10", fetchedOn: "2026-09-10", onOfficialList: true as const };
  const gone = { id: 3, source: "ams-list", sources: ["ams-list"], postedOn: null, fetchedOn: "2026-10-01", onOfficialList: false as const };
  const rotated = { id: 4, source: "yufan", sources: ["yufan"], postedOn: null, fetchedOn: "2026-11-06", onOfficialList: false as const };
  const plan = planCleanup({
    seasonCertain: true, seasonStart: "2026-11-05", fetchFailed: false, dryRun: true, max: 10, minFresh: 1, fresh: 3, listKnown: true,
    codes: [kept, gone, rotated],
  });
  assert.deepEqual(plan.ids, [3]);
  assert.equal(plan.dryRun, true);
});

test("a certain season deletes the previous season's community code and leaves the new one", async () => {
  await sql`INSERT INTO loadout_seasons (name, number, starts_on, source, confidence, evidence)
    VALUES ('测试季', NULL, '2026-11-05', 'announcement', 'certain', 'fixture')`;
  const fresh = "K416突击步枪-烽火地带-6SEASONFRESH1234567";
  const old = "M4A1突击步枪-烽火地带-6SEASONOLDCODE12345";
  const at = new Date("2026-11-06T01:00:00Z");
  for (let i = 0; i < 40; i++) {
    await saveFeedLoadout(sql, "nss", {
      categoryKey: "rifle", weapon: "K416突击步枪", code: `K416突击步枪-烽火地带-6FRESH${String(i).padStart(8, "0")}XX`,
      mode: "烽火地带", priceText: null, author: "甲", sourceUrl: "https://nss.example/gun", postedOn: "2026-11-06", popularity: 1,
    }, at);
  }
  await saveFeedLoadout(sql, "nss", {
    categoryKey: "rifle", weapon: "K416突击步枪", code: fresh, mode: "烽火地带", priceText: null, author: "甲",
    sourceUrl: "https://nss.example/gun", postedOn: "2026-11-06", popularity: 2,
  }, at);
  await saveFeedLoadout(sql, "sjzgq", {
    categoryKey: "rifle", weapon: "M4A1突击步枪", code: old, mode: "烽火地带", priceText: null, author: "乙",
    sourceUrl: "https://sjzgq.example/", postedOn: "2026-08-01", popularity: null,
  }, at);
  await sql`UPDATE loadout_codes SET noted_at = ${beijingMidnight("2026-08-01")} WHERE code = ${old}`;
  const dry = await cleanupOutOfSeason({ db: sql, now: new Date("2026-11-06T04:00:00Z"), env: { LOADOUT_CLEANUP_DRY_RUN: "true", LOADOUT_CLEANUP_MIN_FRESH: "40" } });
  assert.equal(dry.deleted, 0);
  assert.ok(dry.ids.length >= 1);
  const [still] = await sql`SELECT id FROM loadout_codes WHERE code = ${old}`;
  assert.ok(still);
  const live = await cleanupOutOfSeason({ db: sql, now: new Date("2026-11-06T04:00:00Z"), env: { LOADOUT_CLEANUP_DRY_RUN: "false", LOADOUT_CLEANUP_MIN_FRESH: "40", LOADOUT_CLEANUP_MAX: "400" } });
  assert.equal(live.deleted >= 1, true);
  const [gone] = await sql`SELECT id FROM loadout_codes WHERE code = ${old}`;
  assert.equal(gone, undefined);
  const [kept] = await sql`SELECT id FROM loadout_codes WHERE code = ${fresh}`;
  assert.ok(kept);
});

test("authorless yunmaku with no other source and no official detail ranks last and is dropped", async () => {
  const bare = "Vector冲锋枪-全面战场-6BAREYUNMAKU123456";
  const named = "Vector冲锋枪-全面战场-6NAMEDYUNMAKU12345";
  const at = new Date("2026-11-06T01:00:00Z");
  await saveFeedLoadout(sql, "yunmaku", {
    categoryKey: "smg", weapon: "Vector冲锋枪", code: bare, mode: "全面战场", priceText: null, author: null,
    sourceUrl: "https://www.yunmaku.com/loadouts", postedOn: "2026-11-06", popularity: 999,
  }, at);
  await saveFeedLoadout(sql, "yunmaku", {
    categoryKey: "smg", weapon: "Vector冲锋枪", code: named, mode: "全面战场", priceText: null, author: "林树",
    sourceUrl: "https://www.yunmaku.com/loadouts", postedOn: "2026-11-06", popularity: 1,
  }, at);
  const before = await listLoadouts(sql);
  const codes = before.categories.find((category) => category.key === "smg")!.weapons.find((weapon) => weapon.name === "Vector冲锋枪")!.codes;
  assert.equal(codes.at(-1)?.code, bare);
  assert.equal(codes[0]?.code, named);
  assert.equal(await dropBareYunmaku(sql), 1);
  const [left] = await sql`SELECT code FROM loadout_codes WHERE code = ${bare}`;
  assert.equal(left, undefined);
  const [namedRow] = await sql`SELECT code FROM loadout_codes WHERE code = ${named}`;
  assert.equal(namedRow?.code, named);
});

test("a code that is not on the official list is pending, and a missing list keeps the previous status", () => {
  const community = {
    code: "K416突击步枪-烽火地带-6COMMUNITYCODE1234",
    weapon: "K416突击步枪",
    hasDetail: false,
    onOfficialList: false,
    feedSources: [{ absent: false }],
  };
  assert.equal(judgeVerification({ ...community, officialListKnown: true, previous: "ok" }), "pending");
  assert.equal(judgeVerification({
    code: "没这把枪-烽火地带-6BADGUNCODE1234567",
    weapon: "K416突击步枪",
    hasDetail: false,
    officialListKnown: false,
    onOfficialList: false,
    feedSources: [],
    previous: null,
  }), "pending");
  assert.equal(judgeVerification({ ...community, officialListKnown: false, previous: "pending" }), "pending");
  assert.equal(judgeVerification({ ...community, officialListKnown: false, previous: "ok" }), "ok");
  assert.equal(judgeVerification({ ...community, officialListKnown: false, previous: "removed" }), "removed");
  assert.equal(judgeVerification({
    code: "K416突击步枪-烽火地带-6ONTHELISTCODE12345",
    weapon: "K416突击步枪",
    hasDetail: true,
    officialListKnown: true,
    onOfficialList: true,
    feedSources: [{ absent: false }],
    previous: "pending",
  }), "ok");
  assert.equal(judgeVerification({
    code: "K416突击步枪-烽火地带-6REMOVEDCODE1234567",
    weapon: "K416突击步枪",
    hasDetail: false,
    officialListKnown: true,
    onOfficialList: false,
    feedSources: [{ absent: true }],
    previous: "pending",
  }), "removed");
});

test("the code suffix is not turned into attachment ids", () => {
  const decoded = decodeLoadoutCode("MDR突击步枪-烽火地带-6L7K3JG04C9NGO2DGDCB8");
  assert.equal(decoded.ok, false);
  assert.equal(decoded.reason, "opaque");
  assert.match(decoded.detail, /不会猜|解不出|不是配件编号/);
  const decision = decideLoadout({
    code: "K416突击步枪-烽火地带-6STILLACOMMUNITY123",
    weaponHint: null,
    author: null,
    priceText: null,
    postedOn: "2026-08-01",
    sourceUrl: "https://example.invalid",
  }, "2026-11-05");
  assert.equal(decision.ok, false);
  if (!decision.ok) assert.equal(decision.reason, "stale");
});
