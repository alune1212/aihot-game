import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { after, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { migrationPlan } from "../../../scripts/migration-safety.ts";
import {
  explainEnabled, explainRanked, isGroundedExplanation, polishExplanation, polishWithSiteModel, recommendLoadouts, recommendQueryFrom,
} from "../recommend.ts";
import { budgetCost } from "../budget-cost.ts";
import { explanationFacts, rankLoadouts, scoreWeights, templateExplanation, type ScoreInput, type Stats } from "../recommend-rules.ts";
import { aggregateStats, popularityWeight, presentWeaponStats, recomputeAttachmentStats, weaponAttachmentStats, type StatCode } from "../stats.ts";

after(closeDb);

const BANNED = "有力气";

function stats(over: Partial<Stats> = {}): Stats {
  return { meatHarm: 30, armorHarm: 30, shootDistance: 40, recoil: 40, control: 40, stable: 40, hipShot: 40, fireSpeed: 600, ...over };
}

function code(over: Partial<ScoreInput> & Pick<ScoreInput, "id" | "code">): ScoreInput {
  return {
    weapon: "M870霰弹枪",
    categoryKey: "shotgun",
    mode: "烽火地带",
    author: "测试",
    sources: [{ label: "官方热门", url: null }],
    popularity: null,
    tier: null,
    ttkSeconds: null,
    ttkText: null,
    cost: null,
    coverage: null,
    built: stats(),
    parts: [],
    popularityKnown: false,
    ...over,
  };
}

test("attachment weight follows apply count, and consensus follows the weight", () => {
  assert.equal(popularityWeight(null), 1);
  assert.equal(popularityWeight(1000), 4);
  const banned = `${BANNED}握把`;
  const codes: StatCode[] = [
    { weapon: "M870霰弹枪", mode: "烽火地带", popularity: 1000, slots: [
      { slotId: "6", objectId: 11, name: "测试消音器", pic: "https://playerhub.df.qq.com/a.png", grade: 4 },
      { slotId: "8", objectId: 21, name: "垂直握把", pic: null, grade: 3 },
    ] },
    { weapon: "M870霰弹枪", mode: "烽火地带", popularity: null, slots: [
      { slotId: "6", objectId: 11, name: "测试消音器", pic: null, grade: null },
      { slotId: "8", objectId: 22, name: "直角握把", pic: null, grade: 3 },
    ] },
    { weapon: "M870霰弹枪", mode: "烽火地带", popularity: null, slots: [
      { slotId: "6", objectId: 12, name: "测试消焰器", pic: null, grade: 3 },
      { slotId: "8", objectId: 22, name: "直角握把", pic: null, grade: 3 },
    ] },
    { weapon: "M870霰弹枪", mode: "全面战场", popularity: null, slots: [
      { slotId: "6", objectId: 12, name: "测试消焰器", pic: "https://evil.example/a.png", grade: 3 },
      { slotId: "8", objectId: 23, name: banned, pic: null, grade: 2 },
    ] },
  ];
  const at = new Date("2026-11-04T02:00:00.000Z");
  const rows = aggregateStats(codes, at);
  const all = rows.filter((row) => row.mode === "");
  assert.equal(all.find((row) => row.objectId === 11)?.share, 0.7143);
  assert.equal(all.find((row) => row.objectId === 11)?.uses, 2);
  assert.equal(all.find((row) => row.objectId === 21)?.uses, 1);
  assert.equal(all.find((row) => row.objectId === 21)?.share, 0.5714);
  assert.equal(rows.some((row) => row.mode === "烽火地带"), true);
  assert.equal(rows.some((row) => row.mode === "全面战场"), false);
  const view = presentWeaponStats(all);
  assert.equal(view?.groups[0]?.consensus.find((item) => item.slotId === "6")?.name, "测试消音器");
  assert.equal(view?.groups[0]?.consensus.find((item) => item.slotId === "8")?.name, "垂直握把");
  assert.equal(JSON.stringify(view).includes(BANNED), false);
  assert.equal(JSON.stringify(view).includes("evil.example"), false);
});

test("recommendation score stays on the real codes and prefers the asked playstyle", () => {
  for (const prefs of [false, true]) {
    for (const budget of [false, true]) {
      const weights = scoreWeights(prefs, budget);
      const sum = weights.style + weights.prefs + weights.popular + weights.tier + weights.ttk + weights.budget;
      assert.equal(sum, 100);
    }
  }
  const hip = code({ id: 1, code: "M870霰弹枪-烽火地带-6HIPSHOTCODE00001", built: stats({ hipShot: 90, shootDistance: 10, fireSpeed: 700 }), popularity: 10 });
  const range = code({ id: 2, code: "M870霰弹枪-烽火地带-6RANGECODE000001", built: stats({ hipShot: 10, shootDistance: 90 }), popularity: 999 });
  const ranked = rankLoadouts([range, hip], { mode: "烽火地带", style: "hip", stats: [], weapon: null, category: null, budget: null, unknownWeapon: false });
  assert.equal(ranked.ranked[0]?.code, hip.code);
  assert.equal(ranked.ranked[1]?.code, range.code);
  const far = rankLoadouts([hip, range], { mode: null, style: "range", stats: ["shootDistance"], weapon: "M870霰弹枪", category: null, budget: null, unknownWeapon: false });
  assert.equal(far.ranked[0]?.code, range.code);
  const cheap = code({ id: 3, code: "M870霰弹枪-烽火地带-6CHEAPCODE000001", cost: 50_000, built: stats(), popularity: 1 });
  const dear = code({ id: 4, code: "M870霰弹枪-烽火地带-6DEARCODE0000001", cost: 150_000, built: stats(), popularity: 1 });
  const unpriced = code({ id: 5, code: "M870霰弹枪-烽火地带-6NOPRICECODE0001", cost: null, built: stats(), popularity: 1 });
  const budgeted = rankLoadouts([dear, unpriced, cheap], { mode: null, style: "balanced", stats: [], weapon: null, category: null, budget: 200_000, unknownWeapon: false });
  assert.equal(budgeted.pricesAvailable, true);
  assert.equal(budgeted.budgetApplied, true);
  assert.deepEqual(budgeted.ranked.map((item) => item.code), [cheap.code, dear.code]);
  assert.ok(budgeted.ranked[0]!.score > budgeted.ranked[1]!.score);
  const open = rankLoadouts([dear, cheap], { mode: null, style: "balanced", stats: [], weapon: null, category: null, budget: 10_000, unknownWeapon: false });
  open.pricesAvailable = false;
  const noPrices = rankLoadouts(
    [dear, cheap].map((item) => ({ ...item, cost: null })),
    { mode: null, style: "balanced", stats: [], weapon: null, category: null, budget: 10_000, unknownWeapon: false },
  );
  assert.equal(noPrices.budgetApplied, false);
  assert.equal(noPrices.matched, 2);
  const known = new Set([hip.code, range.code, cheap.code, dear.code, unpriced.code]);
  for (const item of [...ranked.ranked, ...far.ranked, ...budgeted.ranked, ...noPrices.ranked]) assert.equal(known.has(item.code), true);
});

test("a partial market price is not a budget", () => {
  const partial = budgetCost([{ objectId: 1, name: "枪身" }, { objectId: 2, name: "消音" }], new Map([[1, 80_000]]));
  assert.equal(partial.coverage, 50);
  assert.equal(partial.spendable, null);
  assert.deepEqual(partial.missing, ["消音"]);
  const full = budgetCost([{ objectId: 1, name: "枪身" }, { objectId: 2, name: "消音" }], new Map([[1, 80_000], [2, 20_000]]));
  assert.equal(full.coverage, 100);
  assert.equal(full.spendable, 100_000);
  const ranked = rankLoadouts([
    code({ id: 1, code: "M870霰弹枪-烽火地带-6FULLPRICECODE001", cost: full.spendable, coverage: full.coverage }),
    code({ id: 2, code: "M870霰弹枪-烽火地带-6PARTPRICECODE001", cost: partial.spendable, coverage: partial.coverage }),
  ], { mode: null, style: "balanced", stats: [], weapon: null, category: null, budget: 200_000, unknownWeapon: false });
  assert.equal(ranked.pricesAvailable, true);
  assert.deepEqual(ranked.ranked.map((item) => item.code), ["M870霰弹枪-烽火地带-6FULLPRICECODE001"]);
  const onlyPartial = rankLoadouts([
    code({ id: 2, code: "M870霰弹枪-烽火地带-6PARTPRICECODE001", cost: null, coverage: 50 }),
  ], { mode: null, style: "balanced", stats: [], weapon: null, category: null, budget: 10_000, unknownWeapon: false });
  assert.equal(onlyPartial.pricesAvailable, false);
  assert.equal(onlyPartial.budgetApplied, false);
  assert.equal(onlyPartial.matched, 1);
});

test("template text stays inside the facts, and a model that invents a gun or a number is dropped", async () => {
  const item = rankLoadouts([code({
    id: 1,
    code: "M870霰弹枪-烽火地带-6TEMPLATECODE001",
    built: stats({ hipShot: 80, shootDistance: 20 }),
    parts: [{ slotId: "6", slotName: "枪口", name: "测试消音器", share: 0.71 }],
    tier: "A",
    ttkText: "理论 TTK 0.4秒",
    popularityKnown: true,
  })], { mode: null, style: "hip", stats: [], weapon: null, category: null, budget: null, unknownWeapon: false }).ranked[0]!;
  const facts = explanationFacts(item, "hip", []);
  facts.costText = "10万";
  const template = templateExplanation(facts);
  assert.equal(isGroundedExplanation(template.text, facts), true);
  assert.equal(template.text.includes(item.code), false);
  assert.equal(JSON.stringify(template).includes(BANNED), false);
  const explained = await explainRanked([item], "hip", []);
  assert.equal(explained[0]?.explanationSource, "template");
  assert.equal(explained[0]?.code, item.code);
  assert.equal(await polishExplanation(facts, async () => template.text), template.text);
  assert.equal(await polishExplanation(facts, async () => "换成 M4A1突击步枪 更合适。"), null);
  assert.equal(await polishExplanation(facts, async () => `${facts.weapon} 伤害 999，很适合腰射。`), null);
  assert.equal(await polishExplanation(facts, async () => `${facts.weapon} 方案码 ABCDEFGHIJKL 能用。`), null);
  assert.equal(await polishExplanation(facts, async () => { throw new Error("down"); }), null);
  assert.equal(explainEnabled(), false);
  assert.equal(await polishWithSiteModel(facts), null);
  const parsed = recommendQueryFrom(new URLSearchParams("style=hip&stats=hipShot,nope&budget=12.5&weapon=没有这把"));
  assert.equal(parsed.style, "hip");
  assert.deepEqual(parsed.stats, ["hipShot"]);
  assert.equal(parsed.budget, 125_000);
  assert.equal(parsed.unknownWeapon, true);
});

test("attachment stats migration is a single online statement and does not reuse a filename", () => {
  const text = readFileSync(new URL("../migrations/0115_loadout_attachment_stats.sql", import.meta.url), "utf8");
  assert.equal(migrationPlan(text).kind, "transaction");
  const counts = new Map<string, number>();
  for (const dir of ["../../../database/migrations", "../migrations"]) {
    for (const name of readdirSync(new URL(dir, import.meta.url))) {
      if (!name.endsWith(".sql")) continue;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  assert.equal(counts.get("0115_loadout_attachment_stats.sql"), 1);
  assert.equal(counts.get("0113_loadout_attachment_stats.sql") ?? 0, 0);
});

test("official details are aggregated and only those codes are recommended", async () => {
  const weapon = "M870霰弹枪";
  const hipCode = `${weapon}-烽火地带-6HIPSHOTCODE00001`;
  const midCode = `${weapon}-烽火地带-6MIDCODE000000001`;
  const farCode = `${weapon}-烽火地带-6RANGECODE000001`;
  const warCode = `${weapon}-全面战场-6WARCODE00000001`;
  const bareCode = `${weapon}-烽火地带-6NODETAILCODE0005`;
  const bannedPart = `${BANNED}握把`;
  await sql`DELETE FROM loadout_codes WHERE weapon = ${weapon}`;
  const origin = (over: Partial<Stats>) => ({ meatHarm: 30, armorHarm: 30, shootDistance: 30, recoil: 40, control: 40, stable: 40, hipShot: 40, fireSpeed: 600, ...over });
  const body = (gunId: number, built: Partial<Stats>, slots: Array<{ slotId: string; objectId: number; name: string }>) => ({
    source: "ams",
    name: "测试方案",
    previewPic: null,
    gun: { objectId: gunId, name: weapon, pic: "https://playerhub.df.qq.com/playerhub/60004/object/gun.png", grade: 3 },
    properties: { origin: origin(built), change: null, fireMode: null, muzzleVelocity: null, capacity: null },
    slots: slots.map((slot) => ({
      slotId: slot.slotId,
      slotName: slot.slotId === "6" ? "枪口" : "前握把",
      objectId: slot.objectId,
      name: slot.name,
      pic: "https://playerhub.df.qq.com/playerhub/60004/object/part.png",
      grade: 4,
      effects: [],
    })),
  });
  const inserted = [
    { code: hipCode, mode: "烽火地带", author: BANNED, popularity: 1000, source: "yufan", payload: body(1001, { hipShot: 90, shootDistance: 15 }, [{ slotId: "6", objectId: 11, name: "测试消音器" }, { slotId: "8", objectId: 21, name: "垂直握把" }]) },
    { code: midCode, mode: "烽火地带", author: "路人", popularity: null, source: "nss", payload: body(1002, { hipShot: 50, shootDistance: 50 }, [{ slotId: "6", objectId: 11, name: "测试消音器" }, { slotId: "8", objectId: 22, name: "直角握把" }]) },
    { code: farCode, mode: "烽火地带", author: "路人", popularity: null, source: "nss", payload: body(1003, { hipShot: 15, shootDistance: 90 }, [{ slotId: "6", objectId: 12, name: "测试消焰器" }, { slotId: "8", objectId: 22, name: "直角握把" }]) },
    { code: warCode, mode: "全面战场", author: "路人", popularity: null, source: "nss", payload: body(1004, { hipShot: 20 }, [{ slotId: "6", objectId: 12, name: "测试消焰器" }, { slotId: "8", objectId: 23, name: bannedPart }]) },
  ];
  for (const item of inserted) {
    const [row] = await sql<{ id: number }[]>`
      INSERT INTO loadout_codes (game_id, category_key, weapon, code, mode, author, source, source_url, popularity, noted_at)
      VALUES ('delta-force', 'shotgun', ${weapon}, ${item.code}, ${item.mode}, ${item.author}, ${item.source}, 'https://guns.yufantechs.com/official', ${item.popularity}, now())
      RETURNING id`;
    await sql`INSERT INTO loadout_details (loadout_id, source, gun_object_id, payload)
      VALUES (${row!.id}, 'ams', ${(item.payload.gun.objectId)}, ${sql.json(item.payload)})`;
    await sql`INSERT INTO loadout_code_sources (loadout_id, source, source_url)
      VALUES (${row!.id}, ${item.source}, 'https://guns.yufantechs.com/official')`;
  }
  await sql`INSERT INTO loadout_codes (game_id, category_key, weapon, code, mode, author, source, noted_at)
    VALUES ('delta-force', 'shotgun', ${weapon}, ${bareCode}, '烽火地带', '路人', 'nss', now())`;
  await sql`INSERT INTO loadout_weapon_balance (weapon, tier, tier_as_of, ttk)
    VALUES (${weapon}, 'A', '2026-09-14', ${sql.json({ seconds: 0.42, scenario: "默认", atMeters: 20, version: "s11" })})
    ON CONFLICT (weapon) DO UPDATE SET tier = EXCLUDED.tier, ttk = EXCLUDED.ttk`;
  const written = await recomputeAttachmentStats();
  assert.ok(written.rows >= 1);
  const view = await weaponAttachmentStats(sql, weapon);
  assert.equal(view?.groups[0]?.mode, "");
  assert.equal(view?.groups[0]?.sample, 4);
  assert.equal(view?.groups.some((group) => group.mode === "烽火地带"), true);
  assert.equal(view?.groups.some((group) => group.mode === "全面战场"), false);
  assert.equal(view?.groups[0]?.consensus.find((item) => item.slotId === "6")?.name, "测试消音器");
  assert.equal(JSON.stringify(view).includes(BANNED), false);

  const query = { mode: "烽火地带" as const, style: "hip" as const, stats: [], weapon, category: null, budget: null, unknownWeapon: false };
  const open = await recommendLoadouts(sql, query);
  assert.deepEqual(open.results.map((item) => item.code), [hipCode, midCode, farCode]);
  assert.equal(open.results[0]?.sources[0]?.label, "官方热门");
  assert.equal(open.results[0]?.sources[0]?.url, null);
  assert.equal(open.results[0]?.author, null);
  assert.equal(open.results[0]?.tier, "A");
  assert.match(open.results[0]?.ttkText ?? "", /0\.4秒/);
  assert.equal(open.pricesAvailable, false);
  assert.equal(open.budgetApplied, false);
  assert.equal(JSON.stringify(open).includes(BANNED), false);
  assert.equal(open.results.some((item) => item.code === bareCode), false);
  for (const item of open.results) assert.equal(inserted.some((row) => row.code === item.code), true);

  const priced = [
    [1001, 80_000], [11, 20_000], [21, 5_000], [22, 1_000],
    [1003, 400_000], [12, 50_000],
  ] as const;
  for (const [objectId, price] of priced) {
    await sql`INSERT INTO loadout_item_prices (object_id, price, source, priced_at)
      VALUES (${objectId}, ${price}, 'ams', now())
      ON CONFLICT (object_id) DO UPDATE SET price = EXCLUDED.price`;
  }
  const budgeted = await recommendLoadouts(sql, { ...query, budget: 150_000 });
  assert.equal(budgeted.pricesAvailable, true);
  assert.equal(budgeted.budgetApplied, true);
  assert.deepEqual(budgeted.results.map((item) => item.code), [hipCode]);
  assert.equal(budgeted.results[0]?.cost, 105_000);
  assert.equal(budgeted.results[0]?.coverage, 100);
  for (const file of ["../web/heat.tsx", "../web/recommend.tsx", "../recommend-rules.ts"]) {
    assert.equal(readFileSync(new URL(file, import.meta.url), "utf8").includes(BANNED), false);
  }
});
