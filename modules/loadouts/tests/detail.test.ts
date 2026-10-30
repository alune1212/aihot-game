import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { codeKey, parseLatestPrices, parseSolutionPage, qqCookie, readAms, redactSecrets, safePic } from "../ams.ts";
import { loadoutDetail, priceLoadoutList, summarizePrices, syncLoadoutDetails, syncLoadoutPrices, type IdeFetch } from "../detail.ts";
import { listLoadouts } from "../store.ts";

const fixture = (name: string) => readFileSync(path.join(import.meta.dirname, "fixtures", name), "utf8");
const AMS = fixture("ams-solution.json");
const CODE = "K416突击步枪-烽火地带-6FIXTURECODE12345";
const OTHER = "MP5冲锋枪-烽火地带-6YUFANFIXTURE123456";
const TOKEN = "SECRETTOKENVALUE";

after(closeDb);

test("login failures are ret 101 and 107, and secrets never stay in the message", () => {
  assert.equal(readAms(200, JSON.stringify({ ret: 107, sMsg: "登录态无效" })).ok, false);
  const expired = readAms(200, JSON.stringify({ ret: 101, sMsg: "非常抱歉，请先登录！" }));
  assert.equal(expired.ok, false);
  if (expired.ok) return;
  assert.equal(expired.auth, true);
  assert.equal(expired.retry, false);
  assert.match(expired.message, /ret 101/);
  const limited = readAms(200, JSON.stringify({ ret: -201, sMsg: "访问人数太多" }));
  if (limited.ok) return;
  assert.equal(limited.retry, true);
  assert.equal(limited.auth, false);
  const cookie = qqCookie({ DF_QQ_COOKIE: `skey=drop-me; openid=OPENIDVALUE; acctype=wx; access_token=${TOKEN}` });
  assert.ok(cookie);
  assert.match(cookie.header, /acctype=wx/);
  assert.equal(cookie.header.includes("skey"), false);
  assert.equal(qqCookie({ DF_QQ_COOKIE: "openid=only" }), null);
  const once = redactSecrets(`boom ${cookie.header} 保留`, cookie.secrets);
  assert.equal(once.includes(TOKEN), false);
  assert.match(once, /access_token=\*\*\*/);
  assert.match(redactSecrets(once, cookie.secrets), /保留/);
});

test("a solution page becomes slots, before/after stats and prices", () => {
  const read = readAms(200, AMS);
  assert.equal(read.ok, true);
  if (!read.ok) return;
  const page = parseSolutionPage(read.data);
  assert.ok(page);
  assert.equal(page.total, 1);
  assert.equal(codeKey(page.items[0]!.code), codeKey(` ${CODE} `));
  const payload = page.items[0]!.payload;
  assert.equal(payload.gun.name, "K416突击步枪");
  assert.equal(payload.properties?.origin.fireSpeed, 880);
  assert.equal(payload.properties?.change?.control, -3);
  assert.equal(payload.properties?.fireMode, "全自动/单发");
  assert.equal(payload.slots[0]?.slotName, "枪口");
  assert.equal(payload.slots[0]?.name, "测试消音器");
  assert.equal(payload.slots[0]?.effects[0]?.color, "green");
  assert.equal(payload.slots[0]?.effects[1]?.color, "red");
  assert.equal(payload.slots[1]?.name, null);
  assert.equal(safePic("http://playerhub.df.qq.com/a.png"), null);
  assert.equal(safePic("https://evil.example/a.png"), null);
  const prices = parseLatestPrices({ data: { data: { dataMap: { "13130000164": { avgPrice: 15000 } } } } });
  assert.deepEqual(prices, [{ objectId: 13130000164, price: 15000 }]);
  const summary = summarizePrices(18010000001, payload.slots, new Map([
    [18010000001, { price: 90000, at: "2026-10-30T07:00:00.000Z" }],
    [13130000164, { price: 12000, at: "2026-10-30T07:04:00.000Z" }],
  ]));
  assert.equal(summary.complete, true);
  assert.equal(summary.total, 102000);
  assert.equal(summary.pricedAt, "2026-10-30T07:04:00.000Z");
});

test("sync keeps the official cache, leaves unknown codes empty, and a failed login does not leak the cookie", async () => {
  await sql`DELETE FROM loadout_codes WHERE code IN (${CODE}, ${OTHER})`;
  await sql`DELETE FROM loadout_item_prices WHERE object_id IN (18010000001, 13130000164)`;
  await sql`DELETE FROM loadout_feeds WHERE id IN ('ams', 'ams-price')`;
  await sql`INSERT INTO loadout_codes (game_id, category_key, weapon, code, mode, author, source, source_url, noted_at)
    VALUES
      ('delta-force', 'rifle', 'K416突击步枪', ${CODE}, '烽火地带', '测试', 'yufan', 'https://guns.yufantechs.com/official', now()),
      ('delta-force', 'smg', 'MP5冲锋枪', ${OTHER}, '烽火地带', '路人', 'yunmaku', 'https://www.yunmaku.com/loadouts', now())`;
  const env = { DF_QQ_COOKIE: `openid=OPENIDVALUE; acctype=qc; appid=101491592; access_token=${TOKEN}` };
  const sleep = async () => {};
  let amsCalls = 0;
  const fetchPage: IdeFetch = async (url, init) => {
    assert.equal(url.includes("supabase.co"), false);
    if (!url.includes("comm.ams.game.qq.com")) throw new Error(`unexpected ${url}`);
    amsCalls += 1;
    assert.equal(init?.headers?.cookie?.includes(TOKEN), true);
    assert.match(decodeURIComponent(init?.body ?? ""), /dfm\/solution\.arms\.list/);
    return { status: 200, text: () => AMS };
  };
  const synced = await syncLoadoutDetails({ fetch: fetchPage, sleep, env });
  assert.equal(synced.ok, true);
  assert.equal(synced.missing, 1);
  assert.equal(amsCalls, 1);
  const [k416] = await sql<{ id: number }[]>`SELECT id FROM loadout_codes WHERE code = ${CODE}`;
  const detail = await loadoutDetail(sql, k416!.id);
  assert.equal(detail?.code.source, "官方热门");
  assert.equal(detail?.code.sourceUrl, null);
  assert.equal(detail?.detail?.source, "ams");
  assert.equal(detail?.detail?.properties?.change?.recoil, 6);
  assert.equal(detail?.detail?.slots[0]?.price, 12000);
  assert.equal(detail?.detail?.prices.total, 102000);
  assert.equal(detail?.categoryLabel, "步枪");
  assert.equal(detail?.gun.grade, 0);
  assert.equal(detail?.detail?.gun.grade, 0);
  assert.match(detail?.gun.pic ?? "", /18010000001\.png$/);
  assert.equal(detail?.siblings.some((item) => item.id === k416!.id && item.hasDetail && item.name === "测试全面改"), true);
  assert.equal(detail?.related.length, 0);
  const [mp5] = await sql<{ id: number }[]>`SELECT id FROM loadout_codes WHERE code = ${OTHER}`;
  const mp5View = await loadoutDetail(sql, mp5!.id);
  assert.equal(mp5View?.detail, null);
  assert.equal(mp5View?.gun.pic, null);
  assert.equal(mp5View?.categoryLabel, "冲锋枪");

  const priced = await syncLoadoutPrices({
    fetch: async (url, init) => {
      assert.equal(url.includes("supabase.co"), false);
      assert.match(decodeURIComponent(init?.body ?? ""), /object\.price\.latest/);
      return { status: 200, text: () => JSON.stringify({ ret: 0, jData: { data: { data: { dataMap: {
        "18010000001": { avgPrice: 100000 },
        "13130000164": { avgPrice: 20000 },
      } } } } }) };
    },
    sleep,
    env,
  });
  assert.equal(priced.ok, true);
  const refreshed = await loadoutDetail(sql, k416!.id);
  assert.equal(refreshed?.detail?.prices.total, 120000);
  const listed = await priceLoadoutList(sql, (await listLoadouts(sql)).categories);
  const shown = listed.flatMap((category) => category.weapons.flatMap((weapon) => weapon.codes)).find((code) => code.code === CODE);
  assert.equal(shown?.totalText, "12万");
  assert.equal(shown?.total, 120000);
  assert.equal(shown?.name, "测试全面改");
  assert.equal(shown?.partCount, 1);
  assert.equal(shown?.parts[0]?.name, "测试消音器");
  assert.equal(shown?.parts[0]?.grade, 4);
  assert.match(shown?.parts[0]?.pic ?? "", /^https:\/\/playerhub\.df\.qq\.com\//);
  const k416Gun = listed.find((category) => category.key === "rifle")!.weapons.find((weapon) => weapon.name === "K416突击步枪")!;
  assert.equal(k416Gun.objectId, 18010000001);
  assert.equal(k416Gun.grade, 0);
  assert.match(k416Gun.pic ?? "", /18010000001\.png$/);
  const hidden = listed.flatMap((category) => category.weapons.flatMap((weapon) => weapon.codes)).find((code) => code.code === OTHER);
  assert.equal(hidden?.totalText, null);
  assert.equal(hidden?.partCount, 0);
  const mp5Gun = listed.find((category) => category.key === "smg")!.weapons.find((weapon) => weapon.name === "MP5冲锋枪")!;
  assert.equal(mp5Gun.pic, null);

  const dead = await syncLoadoutDetails({
    fetch: async (url, init) => {
      if (url.includes("comm.ams.game.qq.com")) throw new Error(`upstream ${init?.headers?.cookie}`);
      throw new Error(`unexpected ${url}`);
    },
    sleep,
    env,
  });
  assert.equal(dead.ok, false);
  assert.equal(String(dead.error).includes(TOKEN), false);
  assert.equal(String(dead.error).includes("OPENIDVALUE"), false);
  const [health] = await sql<{ last_error: string | null }[]>`SELECT last_error FROM loadout_feeds WHERE id = 'ams'`;
  assert.match(health?.last_error ?? "", /已有的官方详情保留/);
  assert.equal(health?.last_error?.includes(TOKEN), false);
  const still = await loadoutDetail(sql, k416!.id);
  assert.equal(still?.detail?.source, "ams");
  assert.equal(still?.detail?.prices.gun, 100000);

  const auth = await syncLoadoutPrices({
    fetch: async (url) => {
      if (url.includes("comm.ams.game.qq.com")) return { status: 200, text: () => JSON.stringify({ ret: 107, sMsg: "登录态无效" }) };
      throw new Error(`unexpected ${url}`);
    },
    sleep,
    env: {},
  });
  assert.equal(auth.ok, false);
  assert.match(String(auth.error), /ret 107/);
  assert.match(String(auth.error), /已缓存的官方价格继续显示/);
  const kept = await loadoutDetail(sql, k416!.id);
  assert.equal(kept?.detail?.slots[0]?.price, 20000);
  const [gun] = await sql<{ weapon: string }[]>`SELECT weapon FROM loadout_guns WHERE weapon = 'K416突击步枪'`;
  assert.equal(gun?.weapon, "K416突击步枪");
});

test("a gun picture is recorded from the official list even when that code is not stored, and codes without a detail reuse it", async () => {
  const code = "Vector冲锋枪-全面战场-6GUNMAPFIXTURE1234";
  const awm = "AWM狙击步枪-烽火地带-6GUNMAPONLY123456";
  await sql`DELETE FROM loadout_codes WHERE code IN (${code}, ${awm})`;
  await sql`DELETE FROM loadout_guns WHERE weapon IN ('Vector冲锋枪', 'AWM狙击步枪')`;
  const body = JSON.parse(AMS) as { jData: { data: { data: { list: Array<Record<string, unknown>>; totalCount: number } } } };
  const item = body.jData.data.data.list[0]!;
  item.solutionCode = awm;
  const arms = item.armsDetail as Record<string, unknown>;
  arms.objectName = "AWM狙击步枪";
  arms.objectID = 18060000011;
  arms.pic = "https://playerhub.df.qq.com/playerhub/60004/object/18060000011.png";
  arms.grade = 4;
  body.jData.data.data.totalCount = 1;
  const synced = await syncLoadoutDetails({
    fetch: async () => ({ status: 200, text: () => JSON.stringify(body) }),
    sleep: async () => {},
    env: {},
  });
  assert.equal(synced.ok, true);
  assert.equal(synced.guns, 1);
  const [awmGun] = await sql<{ pic: string; grade: number; object_id: string }[]>`
    SELECT pic, grade, object_id::text FROM loadout_guns WHERE weapon = 'AWM狙击步枪'`;
  assert.equal(awmGun?.pic, "https://playerhub.df.qq.com/playerhub/60004/object/18060000011.png");
  assert.equal(awmGun?.grade, 4);
  assert.equal(awmGun?.object_id, "18060000011");
  assert.equal((await sql<{ id: number }[]>`SELECT id FROM loadout_codes WHERE code = ${awm}`).length, 0);

  await sql`INSERT INTO loadout_guns (weapon, category_key, object_id, pic, grade)
    VALUES ('Vector冲锋枪', 'smg', 18020000001, 'https://playerhub.df.qq.com/playerhub/60004/object/18020000001.png', 5)`;
  const [vectorCode] = await sql<{ id: number }[]>`INSERT INTO loadout_codes (game_id, category_key, weapon, code, mode, price_text, source, noted_at)
    VALUES ('delta-force', 'smg', 'Vector冲锋枪', ${code}, '全面战场', '18.2万', 'yunmaku', now()) RETURNING id`;
  const vectorView = await loadoutDetail(sql, vectorCode!.id);
  assert.equal(vectorView?.detail, null);
  assert.equal(vectorView?.gun.pic, "https://playerhub.df.qq.com/playerhub/60004/object/18020000001.png");
  assert.equal(vectorView?.gun.grade, 5);
  assert.equal(vectorView?.code.priceText, "18.2万");
  assert.equal(vectorView?.related.length, 0);
  const listed = await priceLoadoutList(sql, (await listLoadouts(sql)).categories);
  const vector = listed.find((category) => category.key === "smg")!.weapons.find((weapon) => weapon.name === "Vector冲锋枪")!;
  assert.equal(vector.pic, "https://playerhub.df.qq.com/playerhub/60004/object/18020000001.png");
  assert.equal(vector.grade, 5);
  const row = vector.codes.find((item) => item.code === code)!;
  assert.equal(row.totalText, null);
  assert.equal(row.total, null);
  assert.equal(row.partCount, 0);
  assert.deepEqual(row.parts, []);
});
