import { sql, type Db } from "@aihot/backend/db";
import { beijingDate, beijingMidnight } from "@aihot/contracts/time";
import { GAME_ID, isWeaponListed, WEAPON_CATEGORIES, type WeaponCategory } from "./catalog.ts";
import { extractLoadouts } from "./extract.ts";
import { formatApplyCount, formatLikeCount, type FeedRow } from "./codes.ts";
import { isOfficialSource, isPreferredAuthor, presentSources, publicFeed, SEASON_START, sourceOutranks, type ShownSource } from "./feeds.ts";
import { currentSeason } from "./season.ts";
import { EMPTY_BALANCE, presentBalance, type WeaponBalanceView } from "./balance.ts";
import { LOADOUT_PER_WEAPON } from "./query.ts";

export interface LoadoutPart {
  name: string | null;
  pic: string | null;
  grade: number | null;
}

export interface LoadoutCode {
  id: number;
  code: string;
  mode: string | null;
  priceText: string | null;
  author: string | null;
  /** 聚合站的显示名。文章抽出的码没有。主来源，和 sources[0] 一致。 */
  source: string | null;
  sourceUrl: string | null;
  /** 这条码出现过的全部来源。官方热门只出现一次。 */
  sources: ShownSource[];
  notedAt: string | null;
  /** 发布日（北京时间 YYYY-MM-DD）。 */
  postedOn: string | null;
  /** 应用次数的展示，比如「应用 86.4万」。没有就是 null。 */
  popularityText: string | null;
  /** 点赞数的展示，比如「赞 1553」。没有就是 null。 */
  likesText: string | null;
  featured: boolean;
  stale: boolean;
  /** ok 对过官方列表或格式；pending 页面上是「待验证」；removed 是来源已撤下。 */
  verification: "ok" | "pending" | "removed" | null;
  popularity: number | null;
  /** 枪身加配件的最新总价。还没齐的时候是 null，不用方案上的旧标价。 */
  totalText: string | null;
  /** 和 totalText 同一笔官方总价，方便列表算最低价。没有就是 null。 */
  total: number | null;
  /** 官方方案名。这条码还没对上官方详情时是 null。 */
  name: string | null;
  partCount: number;
  parts: LoadoutPart[];
}

export interface LoadoutWeapon {
  name: string;
  /** 官方物品图。这把枪在官方方案里没出现过就是 null。 */
  pic: string | null;
  grade: number | null;
  objectId: number | null;
  tier: string | null;
  tierAsOf: string | null;
  ttkText: string | null;
  ttkNote: string | null;
  patchText: string | null;
  codes: LoadoutCode[];
}

export interface LoadoutCategoryView {
  key: string;
  label: string;
  note: string;
  weapons: LoadoutWeapon[];
}

/** 文章公开内容变了就重抽一遍；撤下时只删这篇文章自己的码，聚合站收录的不动。 */
export async function syncArticleLoadouts(db: Db, articleId: string, reduced: boolean): Promise<void> {
  await db`DELETE FROM loadout_codes WHERE article_id = ${articleId} AND source IS NULL`;
  if (reduced) return;
  const [row] = await db<{ title: string; body_text: string | null; excerpt: string | null; url: string; published_at: Date | null; title_zh: string | null; summary: string | null }[]>`
    SELECT a.title, a.body_text, a.excerpt, a.url, a.published_at, p.title AS title_zh, p.summary
    FROM articles a
    LEFT JOIN publications p ON p.article_id = a.id
    WHERE a.id = ${articleId}`;
  if (!row) return;
  const text = [row.title_zh, row.summary, row.title, row.excerpt, row.body_text].filter(Boolean).join("\n\n");
  const found = extractLoadouts(text);
  for (const item of found) {
    // 聚合站已经收了同一条码时，保留它的作者和来源，也不要把 article_id 写上去（否则撤下文章会把这条一起删掉）。
    await db`INSERT INTO loadout_codes (game_id, category_key, weapon, code, mode, price_text, author, source_url, article_id, noted_at)
      VALUES (${GAME_ID}, ${item.categoryKey}, ${item.weapon}, ${item.code}, ${item.mode}, ${item.priceText}, ${item.author}, ${row.url}, ${articleId}, ${row.published_at})
      ON CONFLICT (game_id, code) DO UPDATE SET
        category_key = CASE WHEN loadout_codes.source IS NULL THEN EXCLUDED.category_key ELSE loadout_codes.category_key END,
        weapon = CASE WHEN loadout_codes.source IS NULL THEN EXCLUDED.weapon ELSE loadout_codes.weapon END,
        mode = CASE WHEN loadout_codes.source IS NULL THEN EXCLUDED.mode ELSE loadout_codes.mode END,
        price_text = CASE WHEN loadout_codes.source IS NULL THEN EXCLUDED.price_text ELSE loadout_codes.price_text END,
        author = CASE WHEN loadout_codes.source IS NULL THEN EXCLUDED.author ELSE loadout_codes.author END,
        source_url = CASE WHEN loadout_codes.source IS NULL THEN EXCLUDED.source_url ELSE loadout_codes.source_url END,
        article_id = CASE WHEN loadout_codes.source IS NULL THEN EXCLUDED.article_id ELSE loadout_codes.article_id END,
        noted_at = CASE WHEN loadout_codes.source IS NULL THEN EXCLUDED.noted_at ELSE loadout_codes.noted_at END`;
  }
}

function postedAt(postedOn: string | null): Date | null {
  return postedOn ? beijingMidnight(postedOn) : null;
}

async function rememberSource(db: Db, loadoutId: number | string, source: string, sourceUrl: string): Promise<void> {
  await db`INSERT INTO loadout_code_sources (loadout_id, source, source_url, seen_at)
    VALUES (${loadoutId}, ${source}, ${sourceUrl}, now())
    ON CONFLICT (loadout_id, source) DO UPDATE SET source_url = EXCLUDED.source_url, seen_at = now()`;
}

/**
 * 写入一条聚合站的码。官方可以盖过社区来源；社区之间先到先得。每个来过的站都记在 loadout_code_sources。
 * 来源没给日期时，用这次抓取时间。开季前的空日期或更早的日期，在这季又见到时改成这次的日期，避免被当成无日期删掉。
 * 带开季前日期的码到不了这里（decideLoadout 已拒绝），所以旧日期不会被写回来。
 */
export async function saveFeedLoadout(db: Db, source: string, row: FeedRow, fetchedAt: Date, seasonStart?: string): Promise<"inserted" | "updated" | "kept"> {
  const seasonAt = seasonStart ? beijingMidnight(seasonStart) : null;
  // 来源仍挂着开季前的日期时不写回：不新建，也不把已经标成本季的码改回旧日期。
  if (row.postedOn && seasonAt && row.postedOn < seasonStart!) return "kept";
  const noted = postedAt(row.postedOn);
  const stamp = noted ?? fetchedAt;
  const popularity = row.popularity ?? null;
  const likes = row.likes ?? null;
  const inserted = await db<{ id: number }[]>`INSERT INTO loadout_codes
    (game_id, category_key, weapon, code, mode, price_text, author, popularity, likes, source, source_url, noted_at, fetched_at)
    VALUES (${GAME_ID}, ${row.categoryKey}, ${row.weapon}, ${row.code}, ${row.mode}, ${row.priceText}, ${row.author}, ${popularity}, ${likes}, ${source}, ${row.sourceUrl}, ${stamp}, ${fetchedAt})
    ON CONFLICT (game_id, code) DO NOTHING RETURNING id`;
  if (inserted.length) {
    await rememberSource(db, inserted[0]!.id, source, row.sourceUrl);
    return "inserted";
  }
  const [existing] = await db<{ id: number; source: string | null }[]>`
    SELECT id, source FROM loadout_codes WHERE game_id = ${GAME_ID} AND code = ${row.code}`;
  if (!existing) return "kept";
  await rememberSource(db, existing.id, source, row.sourceUrl);
  if (!sourceOutranks(source, existing.source)) {
    if (seasonAt) {
      await db`UPDATE loadout_codes SET noted_at = ${stamp}
        WHERE id = ${existing.id} AND (noted_at IS NULL OR noted_at < ${seasonAt})`;
    }
    return "kept";
  }
  await db`UPDATE loadout_codes SET
    category_key = ${row.categoryKey},
    weapon = ${row.weapon},
    mode = ${row.mode},
    price_text = COALESCE(${row.priceText}, price_text),
    author = COALESCE(${row.author}, author),
    popularity = COALESCE(${popularity}, popularity),
    likes = COALESCE(${likes}, likes),
    source = ${source},
    source_url = ${row.sourceUrl},
    noted_at = CASE
      WHEN ${noted}::timestamptz IS NOT NULL THEN ${noted}
      WHEN loadout_codes.noted_at IS NULL THEN ${fetchedAt}
      WHEN ${seasonAt}::timestamptz IS NOT NULL AND loadout_codes.noted_at < ${seasonAt}::timestamptz THEN ${fetchedAt}
      ELSE loadout_codes.noted_at
    END,
    fetched_at = ${fetchedAt},
    article_id = NULL
    WHERE id = ${existing.id}`;
  return "updated";
}

export async function saveWeaponTier(db: Db, weapon: string, tier: string, asOf: string | null): Promise<void> {
  await db`INSERT INTO loadout_weapon_balance (weapon, tier, tier_as_of, synced_at)
    VALUES (${weapon}, ${tier}, ${asOf}, now())
    ON CONFLICT (weapon) DO UPDATE SET tier = EXCLUDED.tier, tier_as_of = EXCLUDED.tier_as_of, synced_at = now()`;
}

export async function saveWeaponTtk(db: Db, weapon: string, ttk: unknown, patch: unknown | null): Promise<void> {
  const ttkJson = sql.json(JSON.parse(JSON.stringify(ttk)));
  const patchJson = patch ? sql.json(JSON.parse(JSON.stringify(patch))) : null;
  await db`INSERT INTO loadout_weapon_balance (weapon, ttk, patch, synced_at)
    VALUES (${weapon}, ${ttkJson}, ${patchJson}, now())
    ON CONFLICT (weapon) DO UPDATE SET
      ttk = EXCLUDED.ttk,
      patch = EXCLUDED.patch,
      synced_at = now()`;
}

/** 过季的码不新收录；这个站以前收过、当时没有日期的，把日期补上，页面就会标成过季。 */
export async function noteStaleLoadouts(db: Db, source: string, rows: readonly FeedRow[]): Promise<number> {
  let noted = 0;
  for (const row of rows) {
    const at = postedAt(row.postedOn);
    if (!at) continue;
    const updated = await db<{ id: number }[]>`UPDATE loadout_codes SET noted_at = ${at}
      WHERE game_id = ${GAME_ID} AND code = ${row.code} AND source = ${source} AND noted_at IS NULL
      RETURNING id`;
    noted += updated.length;
  }
  return noted;
}

export async function recordFeedSuccess(db: Db, id: string, name: string, note: string): Promise<void> {
  await db`INSERT INTO loadout_feeds (id, name, health, fail_count, last_fetch_at, last_ok_at, last_error, note)
    VALUES (${id}, ${name}, 'ok', 0, now(), now(), NULL, ${note})
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      health = 'ok',
      fail_count = 0,
      last_fetch_at = now(),
      last_ok_at = now(),
      last_error = NULL,
      note = EXCLUDED.note`;
}

/** 连续 5 次失败记为 failing，和信源的 health 同一档。 */
export async function recordFeedFailure(db: Db, id: string, name: string, error: string): Promise<void> {
  const message = error.slice(0, 500);
  await db`INSERT INTO loadout_feeds (id, name, health, fail_count, last_fetch_at, last_error)
    VALUES (${id}, ${name}, 'degraded', 1, now(), ${message})
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      fail_count = loadout_feeds.fail_count + 1,
      last_fetch_at = now(),
      last_error = EXCLUDED.last_error,
      health = CASE WHEN loadout_feeds.fail_count + 1 >= 5 THEN 'failing' ELSE 'degraded' END`;
}

function isStale(notedAt: Date | null, seasonStart: string): boolean {
  return !!notedAt && beijingDate(notedAt) < seasonStart;
}

function rankGroup(row: { noted_at: Date | null; source: string | null; author: string | null }, seasonStart: string): number {
  if (isStale(row.noted_at, seasonStart)) return 4;
  if (isOfficialSource(row.source)) return 0;
  if (isPreferredAuthor(row.author)) return 1;
  if (row.source === "yunmaku" && !row.author) return 3;
  return 2;
}

/** 云码库没有作者、也没有别的来源、也没有官方详情的码不留。 */
export async function dropBareYunmaku(db: Db): Promise<number> {
  const dropped = await db<{ id: number }[]>`
    DELETE FROM loadout_codes c
    WHERE c.game_id = ${GAME_ID} AND c.source = 'yunmaku' AND c.author IS NULL
      AND NOT EXISTS (SELECT 1 FROM loadout_code_sources s WHERE s.loadout_id = c.id AND s.source <> 'yunmaku')
      AND NOT EXISTS (SELECT 1 FROM loadout_details d WHERE d.loadout_id = c.id)
    RETURNING c.id`;
  if (dropped.length) console.log(JSON.stringify({ level: "info", msg: "loadout drop bare yunmaku", count: dropped.length }));
  return dropped.length;
}

/** 这一来源完整抓完以后，列表里不再出现的码记上 absent_at。空列表不当成「全部撤下」。 */
export async function reconcileFeedSources(db: Db, source: string, codes: readonly string[]): Promise<number> {
  if (!codes.length) return 0;
  const marked = await db<{ loadout_id: number }[]>`
    UPDATE loadout_code_sources s SET absent_at = now()
    FROM loadout_codes c
    WHERE s.loadout_id = c.id AND c.game_id = ${GAME_ID} AND s.source = ${source}
      AND s.absent_at IS NULL AND NOT (c.code = ANY(${[...codes]}::text[]))
    RETURNING s.loadout_id`;
  await db`
    UPDATE loadout_code_sources s SET absent_at = NULL
    FROM loadout_codes c
    WHERE s.loadout_id = c.id AND c.game_id = ${GAME_ID} AND s.source = ${source}
      AND c.code = ANY(${[...codes]}::text[])`;
  return marked.length;
}

/** `limitPerWeapon` 为 null 时不截断。页面先筛选再截断，默认调用仍是每把枪 40 条。 */
export async function listLoadouts(db: Db, gameId = GAME_ID, limitPerWeapon: number | null = LOADOUT_PER_WEAPON): Promise<{ gameId: string; categories: LoadoutCategoryView[] }> {
  const catalog: readonly WeaponCategory[] = gameId === GAME_ID ? WEAPON_CATEGORIES : [];
  const season = await currentSeason(db);
  const seasonStart = season.confidence === "certain" ? season.startsOn : SEASON_START;
  const rows = await db<{ id: number; category_key: string; weapon: string; code: string; mode: string | null; price_text: string | null; author: string | null; popularity: number | null; likes: number | null; source: string | null; source_url: string | null; noted_at: Date | null; verification: "ok" | "pending" | "removed" | null }[]>`
    SELECT id, category_key, weapon, code, mode, price_text, author, popularity, likes, source, source_url, noted_at, verification
    FROM loadout_codes
    WHERE game_id = ${gameId}`;
  const sourceRows = rows.length
    ? await db<{ loadout_id: number; source: string; source_url: string | null }[]>`
        SELECT loadout_id, source, source_url FROM loadout_code_sources WHERE loadout_id IN ${db(rows.map((row) => row.id))}`
    : [];
  const sourcesById = new Map<number, { source: string; sourceUrl: string | null }[]>();
  for (const row of sourceRows) {
    const list = sourcesById.get(Number(row.loadout_id)) ?? [];
    list.push({ source: row.source, sourceUrl: row.source_url });
    sourcesById.set(Number(row.loadout_id), list);
  }
  const balanceRows = await db<{ weapon: string; tier: string | null; tier_as_of: string | null; ttk: unknown; patch: unknown }[]>`
    SELECT weapon, tier, tier_as_of, ttk, patch FROM loadout_weapon_balance`;
  const balanceByWeapon = new Map(balanceRows.map((row) => [row.weapon, presentBalance(row)]));
  const ranked = [...rows].sort((a, b) => {
    // 过季最后。官方热门、主播、其他方案，然后才是没有作者的云码库。
    const byGroup = rankGroup(a, seasonStart) - rankGroup(b, seasonStart);
    if (byGroup) return byGroup;
    const byPop = (b.popularity ?? -1) - (a.popularity ?? -1);
    if (byPop) return byPop;
    const aTime = a.noted_at ? -a.noted_at.getTime() : Number.POSITIVE_INFINITY;
    const bTime = b.noted_at ? -b.noted_at.getTime() : Number.POSITIVE_INFINITY;
    if (aTime !== bTime) return aTime - bTime;
    return b.id - a.id;
  });
  const byWeapon = new Map<string, LoadoutCode[]>();
  for (const row of ranked) {
    const list = byWeapon.get(row.weapon) ?? [];
    if (limitPerWeapon !== null && list.length >= limitPerWeapon) continue;
    const postedOn = row.noted_at ? beijingDate(row.noted_at) : null;
    const sources = presentSources(row.source, row.source_url, sourcesById.get(Number(row.id)) ?? []);
    list.push({
      id: row.id,
      code: row.code,
      mode: row.mode,
      priceText: row.price_text,
      author: row.author,
      source: sources[0]?.label ?? publicFeed(row.source, row.source_url).source,
      sourceUrl: sources[0]?.url ?? null,
      sources,
      notedAt: row.noted_at ? row.noted_at.toISOString() : null,
      postedOn,
      popularityText: formatApplyCount(row.popularity),
      likesText: formatLikeCount(row.likes),
      featured: isPreferredAuthor(row.author) && !isStale(row.noted_at, seasonStart),
      stale: isStale(row.noted_at, seasonStart),
      verification: row.verification,
      popularity: row.popularity,
      totalText: null,
      total: null,
      name: null,
      partCount: 0,
      parts: [],
    });
    byWeapon.set(row.weapon, list);
  }
  return {
    gameId,
    categories: catalog.map((category) => ({
      key: category.key,
      label: category.label,
      note: category.note,
      weapons: category.weapons.filter((weapon) => isWeaponListed(weapon)).map((weapon) => ({
        name: weapon.name,
        pic: null,
        grade: null,
        objectId: null,
        ...(balanceByWeapon.get(weapon.name) ?? EMPTY_BALANCE),
        codes: byWeapon.get(weapon.name) ?? [],
      })),
    })),
  };
}
