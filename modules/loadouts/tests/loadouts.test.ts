import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { isWeaponListed, WEAPON_CATEGORIES } from "../catalog.ts";
import { extractLoadouts } from "../extract.ts";
import { gunHref, gunPageCodes, gunSummary, LOADOUT_PER_WEAPON, shapeLoadoutCategories, type LoadoutListQuery } from "../query.ts";
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

test("filters and sorts run before the per-weapon cap", async () => {
  const hidden = {
    id: LOADOUT_PER_WEAPON + 1,
    mode: "全面战场",
    author: "稀有作者",
    source: "鸟兽兽",
    sources: [{ label: "鸟兽兽" }],
    notedAt: "2026-11-02T00:00:00.000Z",
    verification: "pending" as const,
    popularity: 0,
    total: 1000,
  };
  const codes = [
    ...Array.from({ length: LOADOUT_PER_WEAPON }, (_, index) => ({
      id: index + 1,
      mode: "烽火地带",
      author: "路人",
      source: "云码库",
      sources: [{ label: "云码库" }],
      notedAt: "2026-10-01T00:00:00.000Z",
      verification: "ok" as const,
      popularity: 100,
      total: 500_000,
    })),
    hidden,
  ];
  const categories = [{ key: "rifle", label: "步枪", note: "", weapons: [{ name: "M4A1突击步枪", tier: "A", codes }] }];
  const base: LoadoutListQuery = {
    category: null, mode: null, source: null, tier: null, sort: "popularity", q: "", pending: false, minPrice: null, maxPrice: null,
  };
  const listed = async (query: Partial<LoadoutListQuery>) => (
    await shapeLoadoutCategories(categories, { ...base, ...query }, async (rows) => rows)
  )[0]!.weapons[0]!.codes;
  const popular = await listed({});
  assert.equal(popular.length, LOADOUT_PER_WEAPON);
  assert.equal(popular.some((code) => code.author === "稀有作者"), false);
  assert.equal((await listed({ q: "稀有作者" })).some((code) => code.id === hidden.id), true);
  assert.equal((await listed({ source: "鸟兽兽" }))[0]?.id, hidden.id);
  assert.equal((await listed({ mode: "全面战场" }))[0]?.id, hidden.id);
  assert.equal((await listed({ pending: true }))[0]?.id, hidden.id);
  assert.equal((await listed({ sort: "newest" }))[0]?.id, hidden.id);
  assert.equal((await listed({ sort: "price" }))[0]?.id, hidden.id);
  assert.equal((await listed({ maxPrice: 2000 })).map((code) => code.id).includes(hidden.id), true);
  assert.equal((await listed({ category: "smg" })).length, 0);
  assert.equal((await listed({ tier: "S" })).length, 0);
  assert.equal((await listed({ tier: "A", q: "稀有作者" }))[0]?.id, hidden.id);
  const uncapped = await shapeLoadoutCategories(categories, base, async (rows) => rows, false);
  assert.equal(uncapped[0]!.weapons[0]!.codes.length, LOADOUT_PER_WEAPON + 1);
  const page = gunPageCodes(codes, base);
  assert.equal(page.length, LOADOUT_PER_WEAPON + 1);
  assert.equal(gunPageCodes(codes, { ...base, mode: "全面战场" })[0]?.id, hidden.id);
  assert.equal(gunPageCodes(codes, { ...base, sort: "price" })[0]?.id, hidden.id);
  assert.equal(gunSummary(codes).total, LOADOUT_PER_WEAPON + 1);
  assert.equal(gunSummary(codes).modes.find((item) => item.mode === "全面战场")?.count, 1);
  assert.equal(gunSummary(codes).priceMin, 1000);
  assert.equal(gunHref("RM277突击步枪", new URLSearchParams("mode=烽火地带&gun=旧")), "/loadouts/gun/RM277%E7%AA%81%E5%87%BB%E6%AD%A5%E6%9E%AA?mode=%E7%83%BD%E7%81%AB%E5%9C%B0%E5%B8%A6");
});
