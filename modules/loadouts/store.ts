import type { Db } from "@aihot/backend/db";
import { GAME_ID, WEAPON_CATEGORIES, type WeaponCategory } from "./catalog.ts";
import { extractLoadouts } from "./extract.ts";

export interface LoadoutCode {
  code: string;
  mode: string | null;
  priceText: string | null;
  author: string | null;
  sourceUrl: string | null;
  notedAt: string | null;
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

/** 文章公开内容变了就重抽一遍；撤下时删掉只挂在这篇文章上的码。 */
export async function syncArticleLoadouts(db: Db, articleId: string, reduced: boolean): Promise<void> {
  await db`DELETE FROM loadout_codes WHERE article_id = ${articleId}`;
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
    await db`INSERT INTO loadout_codes (game_id, category_key, weapon, code, mode, price_text, author, source_url, article_id, noted_at)
      VALUES (${GAME_ID}, ${item.categoryKey}, ${item.weapon}, ${item.code}, ${item.mode}, ${item.priceText}, ${item.author}, ${row.url}, ${articleId}, ${row.published_at})
      ON CONFLICT (game_id, code) DO UPDATE SET
        category_key = EXCLUDED.category_key,
        weapon = EXCLUDED.weapon,
        mode = EXCLUDED.mode,
        price_text = EXCLUDED.price_text,
        author = EXCLUDED.author,
        source_url = EXCLUDED.source_url,
        article_id = EXCLUDED.article_id,
        noted_at = EXCLUDED.noted_at`;
  }
}

export async function listLoadouts(db: Db, gameId = GAME_ID): Promise<{ gameId: string; categories: LoadoutCategoryView[] }> {
  const catalog: readonly WeaponCategory[] = gameId === GAME_ID ? WEAPON_CATEGORIES : [];
  const rows = await db<{ category_key: string; weapon: string; code: string; mode: string | null; price_text: string | null; author: string | null; source_url: string | null; noted_at: Date | null }[]>`
    SELECT category_key, weapon, code, mode, price_text, author, source_url, noted_at
    FROM loadout_codes
    WHERE game_id = ${gameId}
    ORDER BY noted_at DESC NULLS LAST, id DESC`;
  const byWeapon = new Map<string, LoadoutCode[]>();
  for (const row of rows) {
    const list = byWeapon.get(row.weapon) ?? [];
    if (list.length >= PER_WEAPON) continue;
    list.push({
      code: row.code,
      mode: row.mode,
      priceText: row.price_text,
      author: row.author,
      sourceUrl: row.source_url,
      notedAt: row.noted_at ? row.noted_at.toISOString() : null,
    });
    byWeapon.set(row.weapon, list);
  }
  return {
    gameId,
    categories: catalog.map((category) => ({
      key: category.key,
      label: category.label,
      note: category.note,
      weapons: category.weapons.map((weapon) => ({ name: weapon.name, codes: byWeapon.get(weapon.name) ?? [] })),
    })),
  };
}
