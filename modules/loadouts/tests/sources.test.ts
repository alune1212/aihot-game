import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { parseSolutionCodes, readAms } from "../ams.ts";
import { presentBalance } from "../balance.ts";
import { decideLoadout } from "../codes.ts";
import { DELTACODE_PAGE, DFTTK_MANIFEST, NSS_ORIGIN, TIER_PAGE, feedEnabled, nssGunUrl, sourceOutranks } from "../feeds.ts";
import { fetchAmsCodes, fetchDeltaCodes, fetchNssCodes, fetchWeaponTiers, fetchWeaponTtk, gatherAms, gatherDeltaCode, gatherNss, gatherTier, gatherTtk, type PageFetch } from "../ingest.ts";
import { parseDeltaCode } from "../parse-deltacode.ts";
import { absoluteDfttk, parseDfttkNames, parseDfttkPlan, parseDfttkPreview, parseDfttkRanking, parseRankingIndex, ttkAt } from "../parse-dfttk.ts";
import { nssLastPage, parseNss } from "../parse-nss.ts";
import { parseTierList } from "../parse-tier.ts";
import { listLoadouts } from "../store.ts";

const fixture = (name: string) => readFileSync(path.join(import.meta.dirname, "fixtures", name), "utf8");
const amsBody = fixture("ams-list.json");

after(closeDb);

test("official solution list keeps author, apply count and likes, and drops bad codes later", () => {
  const read = readAms(200, amsBody);
  assert.equal(read.ok, true);
  if (!read.ok) return;
  const parsed = parseSolutionCodes(read.data);
  assert.equal(parsed?.total, 2);
  assert.equal(parsed?.items.length, 4);
  const hot = parsed?.items[0];
  assert.equal(hot?.author, "eStar丨Aqing");
  assert.equal(hot?.applyNum, 267984);
  assert.equal(hot?.likeNum, 1553);
  assert.equal(hot?.weaponHint, "K416突击步枪");
  const decisions = parsed!.items.map((item) => decideLoadout({
    code: item.code,
    weaponHint: item.weaponHint,
    author: item.author,
    priceText: null,
    postedOn: null,
    sourceUrl: "",
    popularity: item.applyNum,
    likes: item.likeNum,
  }));
  assert.equal(decisions.filter((item) => item.ok).length, 1);
  assert.equal(decisions.filter((item) => !item.ok && item.reason === "international").length, 1);
  assert.equal(decisions.filter((item) => !item.ok && item.reason === "unmapped").length, 1);
  assert.equal(decisions.filter((item) => !item.ok && item.reason === "shape").length, 1);
  const kept = decisions.find((item) => item.ok);
  assert.equal(kept && kept.ok ? kept.row.likes : null, 1553);
  assert.equal(kept && kept.ok ? kept.row.popularity : null, 267984);
});

test("the official list walks every page and stops when the total is covered", async () => {
  const seen: string[] = [];
  const fetchPage: PageFetch = async (url, init) => {
    seen.push(`${init?.method ?? "GET"} ${url}`);
    const param = JSON.parse(new URLSearchParams(init?.body ?? "").get("param") ?? "{}") as { page?: number };
    const page = param.page ?? 1;
    const body = JSON.parse(amsBody) as { jData: { data: { data: { page: number; totalCount: number; list: unknown[] } } } };
    body.jData.data.data.page = page;
    body.jData.data.data.totalCount = 21;
    body.jData.data.data.list = page === 1 ? body.jData.data.data.list.slice(0, 1) : [{
      solutionCode: "MP5冲锋枪-烽火地带-6AMSPAGE2CODE12345",
      authorNickname: "第二页",
      applyNum: 20,
      likeNum: 2,
      armsDetail: { objectName: "MP5冲锋枪" },
    }];
    return { status: 200, text: () => JSON.stringify(body) };
  };
  const gathered = await gatherAms(fetchPage, async () => {});
  assert.equal(seen.length, 2);
  assert.equal(gathered.rows.length, 2);
  assert.equal(gathered.rows.find((row) => row.code.includes("AMSPAGE2"))?.author, "第二页");
  assert.equal(gathered.rows.find((row) => row.code.includes("AMSLIST"))?.likes, 1553);
  assert.equal(gathered.warning, null);
});

test("nss html keeps the full code and author, and a 403 stops later pages", async () => {
  const html = fixture("nss.html");
  assert.equal(nssLastPage(html), 2);
  const found = parseNss(html, nssGunUrl(1));
  assert.equal(found.length, 4);
  assert.equal(found[0]?.author, "南波万");
  assert.equal(found[0]?.code, "QCQ171冲锋枪-烽火地带-6KSG9S403H2RB8ICKNGCF");
  const robots = fixture("nss-robots.txt");
  const seen: string[] = [];
  const fetchPage: PageFetch = async (url) => {
    seen.push(url);
    if (url.endsWith("/robots.txt")) return { status: 200, text: () => robots };
    if (url === nssGunUrl(2)) return { status: 403, text: () => "no" };
    return { status: 200, text: () => html };
  };
  const gathered = await gatherNss(fetchPage, async () => {});
  assert.equal(gathered.rows.length, 2);
  assert.equal(gathered.byMode["烽火地带"], 1);
  assert.equal(gathered.byMode["全面战场"], 1);
  assert.equal(gathered.rejected.international, 1);
  assert.equal(gathered.rejected.shape, 1);
  assert.match(gathered.warning ?? "", /403/);
  assert.equal(seen.includes(nssGunUrl(3)), false);
  assert.equal(seen.filter((url) => url.startsWith(NSS_ORIGIN) && !url.endsWith("robots.txt")).length, 2);
});

test("delta-code keeps streamer codes from the public payload and a 403 does not throw", async () => {
  const html = fixture("deltacode.html");
  const raws = parseDeltaCode(html);
  assert.equal(raws.length, 4);
  const live = raws.find((item) => item.code.includes("6DELTACODE"));
  assert.equal(live?.author, "昊天");
  assert.equal(live?.priceText, "21.1万");
  assert.equal(live?.popularity, 1054);
  assert.equal(live?.postedOn, "2026-10-02");
  assert.equal(live?.sourceUrl, "https://delta-code.cn/build/k416-haotian");
  const decisions = raws.map((item) => decideLoadout(item));
  assert.equal(decisions.filter((item) => item.ok).length, 1);
  assert.equal(decisions.filter((item) => !item.ok && item.reason === "stale").length, 1);
  assert.equal(decisions.filter((item) => !item.ok && item.reason === "shape").length, 2);
  const robots = fixture("deltacode-robots.txt");
  const gathered = await gatherDeltaCode(async (url) => {
    if (url.endsWith("/robots.txt")) return { status: 200, text: () => robots };
    assert.equal(url, DELTACODE_PAGE);
    return { status: 200, text: () => html };
  }, async () => {});
  assert.equal(gathered.rows.length, 1);
  assert.equal(gathered.stale.length, 1);
  const blocked = await fetchDeltaCodes({
    fetch: async (url) => {
      if (url.endsWith("/robots.txt")) return { status: 200, text: () => robots };
      return { status: 403, text: () => "Forbidden" };
    },
    sleep: async () => {},
  });
  assert.equal(blocked.ok, false);
  assert.match(String(blocked.error), /403/);
});

test("dfttk ranking uses the base build at the default range and skips unknown guns", () => {
  const plan = parseDfttkPlan(fixture("dfttk-manifest.json"), "https://dfttk.com");
  assert.equal(plan.itemsUrl, "https://dfttk.com/data/releases/fixture/v3/locales/zh-CN/items.json");
  assert.equal(plan.indexUrl, "https://dfttk.com/data/releases/fixture/v3/rankings/firefight/index.json");
  assert.equal(plan.previewUrl, "https://dfttk.com/data/releases/fixture/preview.json");
  const index = parseRankingIndex(fixture("dfttk-index.json"));
  assert.equal(index.label, "5套 · 5弹 · 实战概率");
  assert.equal(absoluteDfttk(plan.baseUrl, index.file), "https://dfttk.com/data/releases/fixture/v3/rankings/firefight/armor-5-ammo-5-default.json");
  const names = parseDfttkNames(fixture("dfttk-items.json"));
  const ranking = parseDfttkRanking(fixture("dfttk-ranking.json"), names, index.label);
  assert.equal(ranking.atMeters, 15);
  assert.deepEqual(ranking.rows.map((row) => row.weapon), ["K416突击步枪", "M250通用机枪"]);
  assert.equal(ranking.rows[0]?.seconds, 6.18);
  assert.equal(ranking.rows[0]?.preview, true);
  assert.equal(ranking.rows[1]?.seconds, 3.5);
  assert.deepEqual(ranking.unmapped, ["没这把枪"]);
  assert.equal(ttkAt([[0, 6.178], [53, 7.24]], 15), 6.18);
  const preview = parseDfttkPreview(fixture("dfttk-preview.json"), names);
  assert.equal(preview.rows.length, 1);
  assert.deepEqual(preview.rows[0]?.lines, ["基础伤害 31 → 32", "衰减距离 54米 / 100米 → 40米 / 100米"]);
  assert.equal(preview.rows[0]?.observedAt, "2026-10-29");
});

test("dfttk and the tier list are stored without ingesting codes", async () => {
  await sql`DELETE FROM loadout_weapon_balance`;
  const files = new Map<string, string>([
    [`${"https://dfttk.com"}/robots.txt`, fixture("dfttk-robots.txt")],
    [DFTTK_MANIFEST, fixture("dfttk-manifest.json")],
    ["https://dfttk.com/data/releases/fixture/v3/locales/zh-CN/items.json", fixture("dfttk-items.json")],
    ["https://dfttk.com/data/releases/fixture/v3/rankings/firefight/index.json", fixture("dfttk-index.json")],
    ["https://dfttk.com/data/releases/fixture/v3/rankings/firefight/armor-5-ammo-5-default.json", fixture("dfttk-ranking.json")],
    ["https://dfttk.com/data/releases/fixture/preview.json", fixture("dfttk-preview.json")],
    ["https://www.dfgqm.com/robots.txt", fixture("dfgqm-robots.txt")],
    [TIER_PAGE, fixture("tier-list.html")],
  ]);
  const fetchPage: PageFetch = async (url) => {
    const body = files.get(url);
    if (!body) throw new Error(`unexpected ${url}`);
    return { status: 200, text: () => body };
  };
  const ttk = await fetchWeaponTtk({ fetch: fetchPage, sleep: async () => {} });
  assert.equal(ttk.ok, true);
  assert.equal(ttk.guns, 2);
  const tier = await fetchWeaponTiers({ fetch: fetchPage, sleep: async () => {} });
  assert.equal(tier.ok, true);
  assert.equal(tier.guns, 3);
  assert.deepEqual(tier.unmapped, ["没这把枪"]);
  const parsed = parseTierList(fixture("tier-list.html"));
  assert.equal(parsed.asOf, "2026-09-14");
  assert.equal(JSON.stringify(parsed).includes("6INTLTIERCODE"), false);
  const [k416] = await sql<{ tier: string; ttk: { seconds: number; preview: boolean }; patch: { lines: string[] } }[]>`
    SELECT tier, ttk, patch FROM loadout_weapon_balance WHERE weapon = 'K416突击步枪'`;
  assert.equal(k416?.tier, "S+");
  assert.equal(k416?.ttk.seconds, 6.18);
  assert.equal(k416?.ttk.preview, true);
  assert.equal(k416?.patch.lines[0], "基础伤害 31 → 32");
  const view = presentBalance({ tier: "S+", tier_as_of: "2026-09-14", ttk: k416?.ttk, patch: k416?.patch });
  assert.equal(view.tier, "S+");
  assert.equal(view.ttkText, "理论 TTK 6.2秒");
  assert.match(view.ttkNote ?? "", /preview/);
  assert.match(view.patchText ?? "", /体验服观察（2026-10-29）/);
});

test("a failing official list does not remove codes already stored, and likes survive", async () => {
  await sql`DELETE FROM loadout_codes`;
  await sql`DELETE FROM loadout_feeds WHERE id IN ('ams-list', 'nss')`;
  const saved = await fetchAmsCodes({
    fetch: async () => ({ status: 200, text: () => amsBody }),
    sleep: async () => {},
    now: () => new Date("2026-10-30T00:00:00+08:00"),
  });
  assert.equal(saved.ok, true);
  assert.equal(saved.inserted, 1);
  const again = await fetchNssCodes({
    fetch: async (url) => {
      if (url.endsWith("/robots.txt")) return { status: 200, text: () => fixture("nss-robots.txt") };
      return { status: 200, text: () => fixture("nss.html").replace('href="/gun?page=2"', "") };
    },
    sleep: async () => {},
    now: () => new Date("2026-10-30T01:00:00+08:00"),
  });
  assert.equal(again.ok, true);
  const failed = await fetchAmsCodes({
    fetch: async () => ({ status: 503, text: () => "down" }),
    sleep: async () => {},
  });
  assert.equal(failed.ok, false);
  const listed = await listLoadouts(sql);
  const k416 = listed.categories.find((category) => category.key === "rifle")!.weapons.find((weapon) => weapon.name === "K416突击步枪")!;
  const code = k416.codes.find((item) => item.code.includes("6AMSLISTCODE"));
  assert.equal(code?.source, "官方热门");
  assert.equal(code?.sourceUrl, null);
  assert.equal(code?.likesText, "赞 1553");
  assert.equal(code?.popularityText, "应用 26.8万");
  assert.equal(code?.author, "eStar丨Aqing");
  const qcq = listed.categories.find((category) => category.key === "smg")!.weapons.find((weapon) => weapon.name === "QCQ171冲锋枪")!;
  assert.equal(qcq.codes[0]?.source, "鸟兽兽");
  assert.equal(feedEnabled("LOADOUT_AMS_ENABLED", { COLLECT_ENABLED: "true", LOADOUT_AMS_ENABLED: "false" }), false);
  assert.equal(feedEnabled("LOADOUT_AMS_ENABLED", { COLLECT_ENABLED: "false", LOADOUT_AMS_ENABLED: "true" }), false);
  assert.equal(feedEnabled("LOADOUT_AMS_ENABLED", { COLLECT_ENABLED: "true", LOADOUT_AMS_ENABLED: "true" }), true);
  assert.equal(sourceOutranks("ams-list", "yunmaku"), true);
  assert.equal(sourceOutranks("yunmaku", "ams-list"), false);
  assert.equal(sourceOutranks("yufan", "ams-list"), false);
  assert.equal(sourceOutranks("nss", "sjzgq"), false);
});

test("tier gather refuses the page when robots disallow it", async () => {
  await assert.rejects(() => gatherTier(async () => ({ status: 200, text: () => "User-agent: *\nDisallow: /\n" }), async () => {}), /robots\.txt/);
});
