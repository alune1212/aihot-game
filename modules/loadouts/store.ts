import type { Db } from "@aihot/backend/db";
import { beijingDate, beijingMidnight } from "@aihot/contracts/time";
import { GAME_ID, isWeaponListed, WEAPON_CATEGORIES, type WeaponCategory } from "./catalog.ts";
import { extractLoadouts } from "./extract.ts";
import type { FeedRow } from "./codes.ts";
import { FEED_LABEL, isPreferredAuthor, SEASON_START } from "./feeds.ts";

export interface LoadoutCode {
  code: string;
  mode: string | null;
  priceText: string | null;
  author: string | null;
  /** 聚合站的显示名。文章抽出的码没有。 */
  source: string | null;
  sourceUrl: string | null;
  notedAt: string | null;
  /** 发布日（北京时间 YYYY-MM-DD）。 */
  postedOn: string | null;
  featured: boolean;
  stale: boolean;
}

export interface LoadoutWeapon {
  name: string;
  codes: LoadoutCode[];
}

export interface LoadoutCategoryView {
  key: string;
  label: string;
  note: string;
  weapons: LoadoutWeapon[];
}

const PER_WEAPON = 40;

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

/** 写入一条聚合站的码。别的站已经收过同一串时保持原样。 */
export async function saveFeedLoadout(db: Db, source: string, row: FeedRow, fetchedAt: Date): Promise<"inserted" | "updated" | "kept"> {
  const noted = postedAt(row.postedOn);
  const inserted = await db<{ id: number }[]>`INSERT INTO loadout_codes
    (game_id, category_key, weapon, code, mode, price_text, author, source, source_url, noted_at, fetched_at)
    VALUES (${GAME_ID}, ${row.categoryKey}, ${row.weapon}, ${row.code}, ${row.mode}, ${row.priceText}, ${row.author}, ${source}, ${row.sourceUrl}, ${noted}, ${fetchedAt})
    ON CONFLICT (game_id, code) DO NOTHING RETURNING id`;
  if (inserted.length) return "inserted";
  const [existing] = await db<{ id: number; source: string | null }[]>`
    SELECT id, source FROM loadout_codes WHERE game_id = ${GAME_ID} AND code = ${row.code}`;
  if (!existing || (existing.source && existing.source !== source)) return "kept";
  await db`UPDATE loadout_codes SET
    category_key = ${row.categoryKey},
    weapon = ${row.weapon},
    mode = ${row.mode},
    price_text = COALESCE(${row.priceText}, price_text),
    author = COALESCE(${row.author}, author),
    source = ${source},
    source_url = ${row.sourceUrl},
    noted_at = COALESCE(${noted}, noted_at),
    fetched_at = ${fetchedAt},
    article_id = NULL
    WHERE id = ${existing.id}`;
  return "updated";
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

function isStale(notedAt: Date | null): boolean {
  return !!notedAt && beijingDate(notedAt) < SEASON_START;
}

export async function listLoadouts(db: Db, gameId = GAME_ID): Promise<{ gameId: string; categories: LoadoutCategoryView[] }> {
  const catalog: readonly WeaponCategory[] = gameId === GAME_ID ? WEAPON_CATEGORIES : [];
  const rows = await db<{ id: number; category_key: string; weapon: string; code: string; mode: string | null; price_text: string | null; author: string | null; source: string | null; source_url: string | null; noted_at: Date | null }[]>`
    SELECT id, category_key, weapon, code, mode, price_text, author, source, source_url, noted_at
    FROM loadout_codes
    WHERE game_id = ${gameId}`;
  const ranked = [...rows].sort((a, b) => {
    const group = (row: typeof a) => (isStale(row.noted_at) ? 2 : isPreferredAuthor(row.author) ? 0 : 1);
    const byGroup = group(a) - group(b);
    if (byGroup) return byGroup;
    const aTime = a.noted_at ? -a.noted_at.getTime() : Number.POSITIVE_INFINITY;
    const bTime = b.noted_at ? -b.noted_at.getTime() : Number.POSITIVE_INFINITY;
    if (aTime !== bTime) return aTime - bTime;
    return b.id - a.id;
  });
  const byWeapon = new Map<string, LoadoutCode[]>();
  for (const row of ranked) {
    const list = byWeapon.get(row.weapon) ?? [];
    if (list.length >= PER_WEAPON) continue;
    const postedOn = row.noted_at ? beijingDate(row.noted_at) : null;
    list.push({
      code: row.code,
      mode: row.mode,
      priceText: row.price_text,
      author: row.author,
      source: row.source ? FEED_LABEL[row.source] ?? row.source : null,
      sourceUrl: row.source_url,
      notedAt: row.noted_at ? row.noted_at.toISOString() : null,
      postedOn,
      featured: isPreferredAuthor(row.author) && !isStale(row.noted_at),
      stale: isStale(row.noted_at),
    });
    byWeapon.set(row.weapon, list);
  }
  return {
    gameId,
    categories: catalog.map((category) => ({
      key: category.key,
      label: category.label,
      note: category.note,
      weapons: category.weapons.filter((weapon) => isWeaponListed(weapon)).map((weapon) => ({ name: weapon.name, codes: byWeapon.get(weapon.name) ?? [] })),
    })),
  };
}
