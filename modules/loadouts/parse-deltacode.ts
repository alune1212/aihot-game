// delta-code 国服配装库把方案放在页面的 Next.js 数据里（initialLoadouts）。
// 只认这份公开 HTML。码尾、套装码和国际服码交给 decideLoadout 丢掉，不按武器名拼回国服码。
import type { RawLoadout } from "./codes.ts";
import { formatGamePrice } from "./parse-yufan.ts";

const PAGE = "https://delta-code.cn/loadouts";

function jsonPrefix(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch (error) {
    const pos = /position (\d+)/.exec(error instanceof Error ? error.message : "")?.[1];
    if (!pos) return null;
    try {
      return JSON.parse(text.slice(0, Number(pos)));
    } catch {
      return null;
    }
  }
}

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.replace(/\s+/g, " ").trim();
  return name || null;
}

function whole(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  if (!Number.isSafeInteger(n) || n < 0 || n > 2_147_483_647) return null;
  return n;
}

function sourceUrl(slug: unknown): string {
  if (typeof slug === "string" && /^[a-z0-9-]{1,80}$/.test(slug)) return `https://delta-code.cn/build/${slug}`;
  return PAGE;
}

function loadoutsFrom(value: unknown): RawLoadout[] {
  if (!Array.isArray(value)) return [];
  const raws: RawLoadout[] = [];
  for (const entry of value) {
    const row = record(entry);
    const code = text(row?.code);
    if (!row || !code) continue;
    const posted = text(row.updatedAt);
    raws.push({
      code,
      weaponHint: text(row.weapon),
      author: text(row.player),
      priceText: formatGamePrice(row.price),
      postedOn: posted && /^\d{4}-\d{2}-\d{2}$/.test(posted) ? posted : null,
      sourceUrl: sourceUrl(row.slug),
      popularity: whole(row.copy_times),
    });
  }
  return raws;
}

/** 从一页 HTML 里取出 initialLoadouts。没有这块数据就返回空数组，调用方决定算不算结构变了。 */
export function parseDeltaCode(html: string): RawLoadout[] {
  const marker = "self.__next_f.push(";
  let from = 0;
  while (from < html.length) {
    const at = html.indexOf(marker, from);
    if (at < 0) break;
    const outer = jsonPrefix(html.slice(at + marker.length));
    from = at + marker.length;
    const inner = Array.isArray(outer) ? outer.find((item) => typeof item === "string" && item.includes("initialLoadouts")) : null;
    if (typeof inner !== "string") continue;
    const key = 'initialLoadouts":';
    const pos = inner.indexOf(key);
    if (pos < 0) continue;
    const parsed = loadoutsFrom(jsonPrefix(inner.slice(pos + key.length)));
    if (parsed.length) return parsed;
  }
  return [];
}

export function deltaCodeHasLoadouts(html: string): boolean {
  return html.includes("initialLoadouts");
}
