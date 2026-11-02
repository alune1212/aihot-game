// 鸟兽兽工具箱的改枪码在 /gun 的服务端 HTML 里。一页一张卡片，data-copy 是完整的「枪名-模式-码」。
import type { RawLoadout } from "./codes.ts";

export function nssLastPage(html: string): number {
  let last = 1;
  for (const match of html.matchAll(/[?&]page=(\d+)/g)) {
    const page = Number(match[1]);
    if (Number.isInteger(page) && page > last && page < 1000) last = page;
  }
  return last;
}

export function parseNss(html: string, sourceUrl: string): RawLoadout[] {
  const raws: RawLoadout[] = [];
  for (const card of html.split(/class="data-card"/).slice(1)) {
    const code = /data-copy="([^"]+)"/.exec(card)?.[1] ?? "";
    if (!code) continue;
    const author = /作者：\s*([^·<]+?)\s*·/.exec(card)?.[1]?.replace(/\s+/g, " ").trim() || null;
    raws.push({
      code,
      weaponHint: null,
      author,
      priceText: null,
      postedOn: null,
      sourceUrl,
      popularity: null,
    });
  }
  return raws;
}
