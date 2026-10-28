// 云码库的改枪码在公开 HTML 里。首页热门卡片和 /loadouts 列表都是一张卡片一条码。
// 列表经常只渲染码尾（十几位），那种对不上国服完整码，交给 decideLoadout 丢掉。
import { cleanCode, type RawLoadout } from "./codes.ts";

const CARD = /<div class="(?:hot-card|group bg-white)\b/g;
const MODES = new Set(["烽火地带", "全面战场", "黑潮爆破"]);

function visible(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

function codeIn(slice: string): string | null {
  const candidates: string[] = [];
  for (const match of slice.matchAll(/data-code="([^"]+)"/g)) candidates.push(cleanCode(match[1]!));
  for (const match of slice.matchAll(/<code\b[^>]*>([\s\S]*?)<\/code>/gi)) candidates.push(cleanCode(match[1]!));
  const full = candidates.find((code) => /-(?:烽火地带|全面战场|黑潮爆破)-[0-9A-Za-z]{12,}$/.test(code));
  return full ?? candidates.find(Boolean) ?? null;
}

function authorIn(slice: string): string | null {
  const match = slice.match(/player\.php\?slug=([^"&\s]+)/);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]!.replace(/\+/g, " "));
  } catch {
    return match[1]!;
  }
}

function priceIn(slice: string): string | null {
  const labels = [...slice.matchAll(/loadout-chip-label">([^<]+)/g)].map((match) => match[1]!.trim());
  const found = labels.find((label) => /\d+(?:\.\d+)?\s*[Ww万]/.test(label));
  if (found) return found.replace(/\s+/g, "");
  const loose = slice.match(/(\d+(?:\.\d+)?)\s*([Ww万])/);
  return loose ? `${loose[1]}${loose[2]}` : null;
}

function hintIn(slice: string): string | null {
  const labels = [...slice.matchAll(/loadout-chip-label">([^<]+)/g)].map((match) => visible(match[1]!));
  return labels.find((label) => label && !MODES.has(label) && !/\d+(?:\.\d+)?\s*[Ww万]/.test(label) && label.length <= 40) ?? null;
}

function dateIn(slice: string): string | null {
  return slice.match(/datetime="(\d{4}-\d{2}-\d{2})"/i)?.[1] ?? null;
}

/** 一页 HTML 里的改枪码。pageUrl 是这一页的地址，有作者时改成作者页。 */
export function parseYunmaku(html: string, pageUrl: string): RawLoadout[] {
  const starts = [...html.matchAll(CARD)].map((match) => match.index ?? 0);
  const slices = starts.length ? starts.map((start, index) => html.slice(start, starts[index + 1] ?? html.length)) : [html];
  const out: RawLoadout[] = [];
  for (const slice of slices) {
    const code = codeIn(slice);
    if (!code) continue;
    const author = authorIn(slice);
    const player = author ? `https://www.yunmaku.com/player.php?slug=${encodeURIComponent(author)}` : null;
    out.push({
      code,
      weaponHint: hintIn(slice),
      author,
      priceText: priceIn(slice),
      postedOn: dateIn(slice),
      sourceUrl: player ?? pageUrl,
    });
  }
  return out;
}
