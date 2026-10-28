// 从一篇文章的文字里抽出改枪码。只认同时写了枪名和「改枪码 / 方案码 / 分享码」的段落。
// 官方小程序的方案库没有公开列表，这里抽不到就不会出现在改枪页上。
import { WEAPON_MATCHERS } from "./catalog.ts";

export interface ExtractedLoadout {
  categoryKey: string;
  weapon: string;
  code: string;
  mode: string | null;
  priceText: string | null;
  author: string | null;
}

const HINT = /改枪码|方案码|分享码|武器分享码/;
const MODE = /烽火地带|全面战场/;
const PRICE = /(?:价格|花费|造价|成本)\s*[:：]?\s*([0-9][0-9,.]{2,})/;
const AUTHOR = /(?:作者|UP主|UP)\s*[:：]\s*([^\s，,。]{1,24})/;

function boundary(alias: string): RegExp {
  const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (/^[A-Za-z0-9]/.test(alias) && /[A-Za-z0-9]$/.test(alias)) return new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, "i");
  return new RegExp(escaped, "i");
}

const MATCHERS = WEAPON_MATCHERS.map((item) => ({ ...item, pattern: boundary(item.alias) }));

function weaponsIn(text: string): Array<{ index: number; categoryKey: string; weapon: string }> {
  const found: Array<{ index: number; categoryKey: string; weapon: string; length: number }> = [];
  for (const item of MATCHERS) {
    const match = item.pattern.exec(text);
    if (!match || match.index === undefined) continue;
    const overlaps = found.some((hit) => match.index < hit.index + hit.length && match.index + item.alias.length > hit.index);
    if (overlaps) continue;
    found.push({ index: match.index, categoryKey: item.categoryKey, weapon: item.weapon, length: item.alias.length });
  }
  return found.sort((a, b) => a.index - b.index);
}

function nearestWeapon(weapons: Array<{ index: number; categoryKey: string; weapon: string }>, at: number) {
  let best = weapons[0]!;
  let distance = Math.abs(best.index - at);
  for (const weapon of weapons.slice(1)) {
    const next = Math.abs(weapon.index - at);
    if (next < distance) {
      best = weapon;
      distance = next;
    }
  }
  return best;
}

/** 一段文字里的改枪码。同一把枪的同一个码只留一次。 */
export function extractLoadouts(text: string): ExtractedLoadout[] {
  const blocks = text.split(/\n{2,}|\r\n\r\n/).flatMap((block) => (block.length > 800 ? block.split(/\n/) : [block]));
  const out: ExtractedLoadout[] = [];
  const seen = new Set<string>();
  for (const block of blocks) {
    if (!HINT.test(block)) continue;
    const weapons = weaponsIn(block);
    if (!weapons.length) continue;
    const mode = block.match(MODE)?.[0] ?? null;
    const priceText = block.match(PRICE)?.[1] ?? null;
    const author = block.match(AUTHOR)?.[1] ?? null;
    const codePattern = /(?:改枪码|方案码|分享码|武器分享码)\s*[:：]?\s*([A-Za-z0-9][A-Za-z0-9_-]{5,48})/g;
    for (const match of block.matchAll(codePattern)) {
      const code = match[1];
      if (!code) continue;
      const weapon = nearestWeapon(weapons, match.index ?? 0);
      const key = `${weapon.weapon}\u0000${code.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ categoryKey: weapon.categoryKey, weapon: weapon.weapon, code, mode, priceText, author });
    }
  }
  return out;
}
