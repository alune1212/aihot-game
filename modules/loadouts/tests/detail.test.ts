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
  const [mp5] = await sql<{ id: number }[]>`SELECT id FROM loadout_codes WHERE code = ${OTHER}`;
  assert.equal((await loadoutDetail(sql, mp5!.id))?.detail, null);

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
  const hidden = listed.flatMap((category) => category.weapons.flatMap((weapon) => weapon.codes)).find((code) => code.code === OTHER);
  assert.equal(hidden?.totalText, null);

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
});
