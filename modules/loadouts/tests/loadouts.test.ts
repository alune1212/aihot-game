import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { isWeaponListed, WEAPON_CATEGORIES } from "../catalog.ts";
import { extractLoadouts } from "../extract.ts";
import { listLoadouts, syncArticleLoadouts } from "../store.ts";

after(closeDb);

test("AN94 stays off the gun bench until the announced release date", () => {
  const rifles = WEAPON_CATEGORIES.find((category) => category.key === "rifle")!;
  const an94 = rifles.weapons.find((weapon) => weapon.name === "AN94突击步枪")!;
  assert.equal(isWeaponListed(an94, new Date("2026-11-04T16:00:00+08:00")), false);
  assert.equal(isWeaponListed(an94, new Date("2026-11-05T00:30:00+08:00")), true);
  const found = extractLoadouts("11月5日 AN94突击步枪 烽火地带 改枪码：An940001");
  assert.equal(found[0]?.weapon, "AN94突击步枪");
});

test("a paragraph with a weapon and a share code becomes one loadout", () => {
  const found = extractLoadouts("M4A1突击步枪，烽火地带。\n改枪码：Ab12cd34\n价格：35000\n作者：洲宝");
  assert.equal(found.length, 1);
  assert.equal(found[0]!.weapon, "M4A1突击步枪");
  assert.equal(found[0]!.categoryKey, "rifle");
  assert.equal(found[0]!.code, "Ab12cd34");
  assert.equal(found[0]!.mode, "烽火地带");
  assert.equal(found[0]!.priceText, "35000");
  assert.equal(found[0]!.author, "洲宝");
});

test("a longer name wins, and a code without a weapon or a hint is ignored", () => {
  assert.deepEqual(extractLoadouts("改枪码：Ab12cd34"), []);
  assert.deepEqual(extractLoadouts("M4A1突击步枪很好用"), []);
  const found = extractLoadouts("M4A1X 不是这把枪。\n\nVector冲锋枪 全面战场 方案码：Zz99qq88");
  assert.equal(found.length, 1);
  assert.equal(found[0]!.weapon, "Vector冲锋枪");
  assert.equal(found[0]!.mode, "全面战场");
});

test("sync stores the code under its weapon and drops it when the article is withdrawn", async () => {
  const id = `loadout-${Date.now().toString(36)}`;
  await sql`INSERT INTO sources (id, name, kind, tier) VALUES (${id}, ${id}, 'rss', 'T1')`;
  await sql`INSERT INTO articles (id, source_id, identity_key, url, title, body_text, discovered_at, timeline_at, published_at)
    VALUES (${id}, ${id}, ${id}, ${`https://example.org/${id}`}, '改枪', ${"SR-25射手步枪 烽火地带 分享码：Sr250001"}, now(), now(), now())`;
  await syncArticleLoadouts(sql, id, false);
  const listed = await listLoadouts(sql);
  const sr = listed.categories.find((category) => category.key === "dmr")!.weapons.find((weapon) => weapon.name === "SR-25射手步枪")!;
  assert.equal(sr.codes[0]?.code, "Sr250001");
  await syncArticleLoadouts(sql, id, true);
  const after = await listLoadouts(sql);
  const empty = after.categories.find((category) => category.key === "dmr")!.weapons.find((weapon) => weapon.name === "SR-25射手步枪")!;
  assert.deepEqual(empty.codes, []);
});
