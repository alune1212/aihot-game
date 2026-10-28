// 洲械库首页渲染第一页；全量方案在首页引用的 /assets/page-*.js 里（对象字面量，不是 JSON 接口）。
// 发布日按脚本里的 throughId 区间和少量按 id 的覆盖来，和页面上的「更新时间」同一套。
import { cleanCode, type RawLoadout } from "./codes.ts";

function visible(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

/** 首页 HTML 里已经渲染出来的那一页。 */
export function parseSjzgqHtml(html: string, pageUrl: string): RawLoadout[] {
  const marker = /<article class="loadout-row\b/g;
  const starts = [...html.matchAll(marker)].map((match) => match.index ?? 0);
  const slices = starts.length ? starts.map((start, index) => html.slice(start, starts[index + 1] ?? html.length)) : [];
  const out: RawLoadout[] = [];
  for (const slice of slices) {
    const code = cleanCode(slice.match(/<code\b[^>]*>([\s\S]*?)<\/code>/i)?.[1] ?? "");
    if (!code) continue;
    const owner = visible(slice.match(/class="loadout-owner"[^>]*>([\s\S]*?)<\/span>/)?.[1] ?? "");
    const [author, extra] = owner.split("·").map((part) => part.trim());
    const price = extra && extra !== "未标注" ? extra : null;
    out.push({
      code,
      weaponHint: visible(slice.match(/<h3[^>]*>([\s\S]*?)<\/h3>/)?.[1] ?? "") || null,
      author: author || null,
      priceText: price,
      postedOn: slice.match(/datetime="(\d{4}-\d{2}-\d{2})"/i)?.[1] ?? null,
      sourceUrl: pageUrl,
    });
  }
  return out;
}

function postedOn(id: number, ranges: ReadonlyArray<{ throughId: number; updatedAt: string }>, overrides: ReadonlyMap<number, string>): string | null {
  return overrides.get(id) ?? ranges.find((range) => id <= range.throughId)?.updatedAt ?? null;
}

/**
 * 从 page-*.js 抽出方案。站点自己藏起来的 id（new Set([...])）不收。
 * 脚本对不上这套字面量时返回空数组，调用方改用首页 HTML。
 */
export function parseSjzgqCatalog(source: string, pageUrl: string): RawLoadout[] {
  const hidden = new Set<number>();
  const hiddenBody = source.match(/new Set\(\[([\d,\s]+)\]\)/)?.[1];
  if (hiddenBody) for (const part of hiddenBody.split(",")) if (part.trim()) hidden.add(Number(part.trim()));

  const streamers = new Map<string, string>();
  for (const match of source.matchAll(/\{id:`([^`]+)`,name:`([^`]+)`,avatar:`/g)) streamers.set(match[1]!, match[2]!);

  const ranges: Array<{ throughId: number; updatedAt: string }> = [];
  for (const match of source.matchAll(/\{throughId:(\d+),updatedAt:`(\d{4}-\d{2}-\d{2})`\}/g)) {
    ranges.push({ throughId: Number(match[1]), updatedAt: match[2]! });
  }
  ranges.sort((a, b) => a.throughId - b.throughId);

  const overrides = new Map<number, string>();
  for (const match of source.matchAll(/\{(\d+:`\d{4}-\d{2}-\d{2}`(?:,\d+:`\d{4}-\d{2}-\d{2}`)*)\}/g)) {
    for (const pair of match[1]!.split(",")) {
      const [id, date] = pair.split(":`");
      if (id && date) overrides.set(Number(id), date.replace(/`$/, ""));
    }
  }

  const out: RawLoadout[] = [];
  const entry = /\{id:(\d+),streamerId:`([^`]*)`,weapon:`([^`]*)`,type:`[^`]*`,style:`[^`]*`,price:`([^`]*)`,code:`([^`]*)`/g;
  for (const match of source.matchAll(entry)) {
    const id = Number(match[1]);
    if (hidden.has(id)) continue;
    const weapon = match[3]!;
    out.push({
      code: cleanCode(match[5]!),
      weaponHint: weapon,
      author: streamers.get(match[2]!) ?? match[2]!,
      priceText: match[4] === "未标注" ? null : match[4]!,
      postedOn: postedOn(id, ranges, overrides),
      sourceUrl: pageUrl,
    });
  }
  return out;
}

/** 首页里的目录脚本。它写在 modulepreload 的 href 上，不一定是 script src。只跟同源。 */
export function sjzgqScriptUrl(html: string, home: string): string | null {
  const match = html.match(/(?:src|href)="(\/assets\/page-[A-Za-z0-9_-]+\.js)"/);
  if (!match) return null;
  const url = new URL(match[1]!, home);
  if (url.origin !== new URL(home).origin) return null;
  return url.toString();
}
