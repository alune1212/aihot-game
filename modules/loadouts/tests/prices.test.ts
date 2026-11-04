import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { feedEnabled } from "../feeds.ts";
import {
  codeCost,
  loadoutCost,
  partialCoverage,
  parseObjectList,
  preferQuote,
  priceNameKey,
  syncMarketPrices,
  writePriceSnapshot,
} from "../prices.ts";
import type { IdeFetch } from "../detail.ts";

const GUN = 18010000021;
const PART = 13130000991;
const MISSING = 13130000993;
const CODE = "K416突击步枪-烽火地带-6PRICETESTCODE01";
const TOKEN = "PRICETOKENSECRET";

function envelope(list: unknown) {
  return JSON.stringify({ ret: 0, jData: { data: { code: 0, data: { list } } } });
}

after(closeDb);

test("a catalog row keeps a positive price and lines up names", () => {
  assert.equal(priceNameKey("测试\u3000消音器"), "测试消音器");
  assert.equal(priceNameKey("ＡＢ"), "ab");
  const items = parseObjectList({
    data: { data: { list: [
      { objectID: GUN, objectName: " K416突击步枪 ", avgPrice: 50000 },
      { objectID: PART, objectName: "测试消音器", avgPrice: 0 },
      { objectID: "nope", objectName: "坏的", avgPrice: 10 },
    ] } },
  });
  assert.deepEqual(items, [{ objectId: GUN, name: "K416突击步枪", price: 50000 }]);
  assert.equal(parseObjectList({ data: { data: {} } }), null);
  const older = { objectId: GUN, name: "K416突击步枪", price: 50000, source: "ams", fetchedAt: "2026-11-01T00:00:00.000Z" };
  const newer = { objectId: GUN, name: "K416突击步枪", price: 99999, source: "other", fetchedAt: "2026-11-04T00:00:00.000Z" };
  assert.equal(preferQuote(older, newer).price, 50000);
  assert.equal(preferQuote(newer, older).source, "ams");
  const cost = codeCost(
    [
      { objectId: GUN, name: "K416突击步枪", kind: "gun" },
      { objectId: MISSING, name: "测试\u3000消音器", kind: "attachment" },
      { objectId: null, name: null, kind: "attachment" },
    ],
    [older, { objectId: PART, name: "测试消音器", price: 8000, source: "other", fetchedAt: "2026-11-04T00:00:00.000Z" }],
  );
  assert.equal(cost.expected, 2);
  assert.equal(cost.known, 2);
  assert.equal(cost.total, 58000);
  assert.equal(cost.coverage, 100);
  assert.equal(cost.source, "mixed");
  assert.equal(cost.parts[1]?.matchedBy, "name");
  assert.equal(cost.parts[1]?.price, 8000);
  const partial = codeCost(
    [{ objectId: GUN, name: "K416突击步枪", kind: "gun" }, { objectId: MISSING, name: "缺价格握把", kind: "attachment" }],
    [older],
  );
  assert.equal(partial.coverage, 50);
  assert.deepEqual(partial.missing, ["缺价格握把"]);
  assert.equal(partial.total, 50000);
  assert.equal(partialCoverage(partial, null), 50);
  assert.equal(partialCoverage(partial, 50000), null);
  assert.equal(partialCoverage(cost, null), null);
});

test("snapshots keep history and an official price is not replaced", async () => {
  await sql`DELETE FROM loadout_codes WHERE code = ${CODE}`;
  await sql`DELETE FROM loadout_price_history WHERE object_id IN (${GUN}, ${PART}, ${MISSING})`;
  await sql`DELETE FROM loadout_item_prices WHERE object_id IN (${GUN}, ${PART}, ${MISSING})`;
  await sql`DELETE FROM loadout_feeds WHERE id = 'ams-catalog'`;
  const early = new Date("2026-11-04T02:00:00.000Z");
  const later = new Date("2026-11-04T03:00:00.000Z");
  await writePriceSnapshot(sql, [{ objectId: GUN, name: "K416突击步枪", price: 99999 }], "other", later);
  await writePriceSnapshot(sql, [{ objectId: GUN, name: "K416突击步枪", price: 50000 }], "ams", early);
  await writePriceSnapshot(sql, [{ objectId: PART, name: "测试消音器", price: 8000 }], "ams", early);
  await writePriceSnapshot(sql, [{ objectId: GUN, name: "K416突击步枪", price: 1 }], "other", later);
  const [latest] = await sql<{ price: number; source: string }[]>`
    SELECT price, source FROM loadout_item_prices WHERE object_id = ${GUN}`;
  assert.equal(latest?.price, 50000);
  assert.equal(latest?.source, "ams");
  const history = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM loadout_price_history WHERE object_id = ${GUN}`;
  assert.equal(history[0]?.n, 2);

  const [inserted] = await sql<{ id: number }[]>`
    INSERT INTO loadout_codes (game_id, category_key, weapon, code, mode, noted_at)
    VALUES ('delta-force', 'rifle', 'K416突击步枪', ${CODE}, '烽火地带', now())
    RETURNING id`;
  await sql`INSERT INTO loadout_details (loadout_id, source, gun_object_id, payload)
    VALUES (${inserted!.id}, 'ams', ${GUN}, ${sql.json({
      source: "ams",
      gun: { objectId: GUN, name: "K416突击步枪" },
      slots: [{ objectId: MISSING, name: "测试\u3000消音器" }],
    })})`;
  const cost = await loadoutCost(sql, inserted!.id);
  assert.equal(cost?.total, 58000);
  assert.equal(cost?.totalText, "5.8万");
  assert.equal(cost?.coverage, 100);
  assert.equal(cost?.source, "ams");
  assert.equal(cost?.parts.find((part) => part.kind === "attachment")?.matchedBy, "name");
  assert.equal(await loadoutCost(sql, inserted!.id + 9_000_000), null);

  let calls = 0;
  const fetchPage: IdeFetch = async (url, init) => {
    assert.equal(url.includes("comm.ams.game.qq.com"), true);
    assert.equal(init?.headers?.cookie, undefined);
    const body = decodeURIComponent(init?.body ?? "");
    calls += 1;
    if (body.includes('"primary":"gun"')) return { status: 200, text: () => envelope([{ objectID: GUN, objectName: "K416突击步枪", avgPrice: 51000 }, { objectID: 1, objectName: "不上架", avgPrice: 0 }]) };
    if (body.includes('"primary":"acc"')) return { status: 200, text: () => envelope([{ objectID: PART, objectName: "测试消音器", avgPrice: 9000 }]) };
    throw new Error(body);
  };
  const synced = await syncMarketPrices({ fetch: fetchPage, sleep: async () => {}, env: {}, now: () => new Date("2026-11-04T04:00:00.000Z") });
  assert.equal(synced.ok, true);
  assert.equal(synced.gun, 1);
  assert.equal(synced.acc, 1);
  assert.equal(calls, 2);
  const again = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM loadout_price_history WHERE object_id IN (${GUN}, ${PART}) AND source = 'ams'`;
  assert.equal(again[0]?.n, 4);
  const [refreshed] = await sql<{ price: number }[]>`SELECT price FROM loadout_item_prices WHERE object_id = ${GUN}`;
  assert.equal(refreshed?.price, 51000);

  const failed = await syncMarketPrices({
    fetch: async (_url, init) => {
      const body = decodeURIComponent(init?.body ?? "");
      if (body.includes('"primary":"gun"')) return { status: 200, text: () => envelope([{ objectID: GUN, objectName: "K416突击步枪", avgPrice: 52000 }]) };
      throw new Error(`upstream ${init?.headers?.cookie}`);
    },
    sleep: async () => {},
    env: { DF_QQ_COOKIE: `openid=OPENIDVALUE; acctype=qc; appid=101491592; access_token=${TOKEN}` },
    now: () => new Date("2026-11-04T05:00:00.000Z"),
  });
  assert.equal(failed.ok, false);
  assert.equal(String(failed.error).includes(TOKEN), false);
  assert.match(String(failed.error), /已写入的价格保留/);
  const [kept] = await sql<{ price: number }[]>`SELECT price FROM loadout_item_prices WHERE object_id = ${PART}`;
  assert.equal(kept?.price, 9000);
  const [gunNow] = await sql<{ price: number }[]>`SELECT price FROM loadout_item_prices WHERE object_id = ${GUN}`;
  assert.equal(gunNow?.price, 52000);
  assert.equal(feedEnabled("LOADOUT_PRICE_AMS_ENABLED", {}), false);
  assert.equal(feedEnabled("LOADOUT_PRICE_AMS_ENABLED", { COLLECT_ENABLED: "true", LOADOUT_PRICE_AMS_ENABLED: "true" }), true);
});
