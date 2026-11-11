// JSON sources: plain JSON APIs, JSON embedded in HTML (script tags, window variables).
import { setTimeout } from "node:timers/promises";
import { credential } from "../config.ts";
import { languageHeaders, requireOk } from "../lib/http-fetch.ts";
import { JINA_PREFIX, jinaRead } from "../providers/jina.ts";
import { fetchListing } from "./listing-fetch.ts";
import { sanitizeBody } from "../content/sanitize.ts";
import { collapseWhitespace, escapeXml, stripTags } from "../lib/text.ts";
import { readPublicationDate, type PublicationDate } from "./dates.ts";
import { FetchError, type Candidate, type SourceRow } from "./types.ts";

export function getPath(obj: unknown, path: string): unknown {
  if (!path) return obj;
  let cur: unknown = obj;
  for (const seg of path.split(".")) {
    if (cur === null || cur === undefined) return undefined;
    if (Array.isArray(cur) && /^\d+$/.test(seg)) cur = cur[Number(seg)];
    else if (typeof cur === "object") cur = (cur as Record<string, unknown>)[seg];
    else return undefined;
  }
  return cur;
}

/** Same-host gap for sources that set minRequestGapMs. Concurrent lists of one API share it. */
const hostGap = new Map<string, { tail: Promise<void>; at: number }>();

async function paceHost(url: string, gapMs: number): Promise<void> {
  if (!Number.isFinite(gapMs) || gapMs <= 0) return;
  let host: string;
  try { host = new URL(url).hostname; } catch { return; }
  const slot = hostGap.get(host) ?? { tail: Promise.resolve(), at: 0 };
  const run = slot.tail.then(async () => {
    const wait = gapMs - (Date.now() - slot.at);
    if (wait > 0) await setTimeout(wait);
    slot.at = Date.now();
  });
  slot.tail = run.then(() => {}, () => {});
  hostGap.set(host, slot);
  await run;
}

/** An http(s) image address. A protocol-relative cover (`//cdn/...`) becomes https. */
function httpUrl(value: string): string | null {
  const text = value.trim();
  if (!text) return null;
  try {
    const url = new URL(text.startsWith("//") ? `https:${text}` : text);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Tag names from `id|名称,id|名称`. The ids are not shown. */
function tagNames(raw: string): string[] {
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const name = (part.includes("|") ? part.slice(part.lastIndexOf("|") + 1) : part).trim();
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

function durationSeconds(item: unknown, path: string | undefined): number | null {
  if (!path) return null;
  const value = getPath(item, path);
  const n = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

/**
 * An mp4 the Tencent player would load for this getinfo document (`QZOutputJson=` or raw JSON).
 * The address is the CDN file plus its vkey. DRM and anything that is not an mp4 on a qqvideo host
 * are skipped: an iframe player is not a body, and a bare IP URL is not served over https.
 */
export function tencentPlayableMp4(payload: string): string | null {
  const start = payload.indexOf("{");
  if (start < 0) return null;
  let data: unknown;
  try { data = JSON.parse(payload.slice(start).replace(/;\s*$/, "")); } catch { return null; }
  const vi = (getPath(data, "vl.vi.0") ?? null) as Record<string, unknown> | null;
  if (!vi || vi.drm) return null;
  const fn = typeof vi.fn === "string" ? vi.fn : "";
  const vkey = typeof vi.fvkey === "string" ? vi.fvkey : "";
  if (!fn.endsWith(".mp4") || !vkey) return null;
    const bases = getPath(vi, "ul.ui");
  if (!Array.isArray(bases)) return null;
  for (const base of bases) {
    const url = base && typeof base === "object" && "url" in base && typeof base.url === "string" ? base.url : "";
    const host = /^https?:\/\/[^/]+\/([a-z0-9.-]+\.qqvideo\.tc\.qq\.com\/.*)$/i.exec(url);
    if (!host) continue;
    return `https://${host[1]}${fn}?vkey=${encodeURIComponent(vkey)}`;
  }
  return null;
}

function coverImage(item: unknown, paths: string[] | undefined): { kind: "image"; url: string; alt: null } | null {
  for (const path of paths ?? []) {
    const value = getPath(item, path);
    if (typeof value !== "string") continue;
    const url = httpUrl(value);
    if (url) return { kind: "image", url, alt: null };
  }
  return null;
}

function firstString(obj: unknown, paths: string[] | undefined): string | null {
  for (const p of paths ?? []) {
    const v = getPath(obj, p);
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return null;
}

/** "{path}" → encoded value, "{raw:path}" → raw value. Returns null when a referenced value is missing. */
export function renderTemplate(template: string, item: unknown): string | null {
  let missing = false;
  const out = template.replace(/\{(raw:)?([^}]+)\}/g, (_m, raw: string | undefined, path: string) => {
    const v = getPath(item, path);
    if (v === undefined || v === null || v === "") {
      missing = true;
      return "";
    }
    return raw ? String(v) : encodeURIComponent(String(v)).replace(/%2F/g, "/");
  });
  return missing ? null : out;
}

/** Calendar days and exact epoch/ISO times preserve the source's stated precision. */
export function toDate(v: unknown, unit: string | undefined, utcOffset: string | undefined): PublicationDate {
  const unknown = { publishedAt: null, publicationTime: null };
  if (v === null || v === undefined || v === "") return unknown;
  let text: string;
  try { text = String(v).trim(); } catch { return unknown; }
  if (unit === "epoch_ms" || unit === "epoch_s") {
    const date = new Date(Number(text) * (unit === "epoch_s" ? 1000 : 1));
    return Number.isFinite(date.getTime()) ? { publishedAt: date, publicationTime: date.toISOString() } : unknown;
  }
  if (unit === "yyyymmdd") {
    const m = /^(\d{4})(\d{2})(\d{2})$/.exec(text);
    return m ? readPublicationDate(`${m[1]}-${m[2]}-${m[3]}`, utcOffset) : unknown;
  }
  return readPublicationDate(text, utcOffset);
}

function findKey(obj: unknown, key: string, depth = 0): unknown {
  if (depth > 12 || obj === null || typeof obj !== "object") return undefined;
  if (!Array.isArray(obj) && key in (obj as Record<string, unknown>)) {
    const v = (obj as Record<string, unknown>)[key];
    if (Array.isArray(v)) return v;
  }
  for (const v of Object.values(obj as Record<string, unknown>)) {
    const found = findKey(v, key, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** Where the object or array literal starting at `start` ends (exclusive), skipping brackets inside strings; -1 when it does not. */
function literalEnd(text: string, start: number): number {
  let depth = 0, inStr: string | null = null, esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'") inStr = ch;
    else if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

function embeddedJson(html: string, source: SourceRow): unknown {
  const mode = source.config.mode;
  if (mode === "html_window_var") {
    const name = String(source.config.windowVar);
    const re = new RegExp(`(?:window\\.)?${name.replace(/[$]/g, "\\$")}\\s*=\\s*`);
    const m = re.exec(html);
    if (!m) throw new FetchError(`window.${name} not found`);
    const start = m.index + m[0].length;
    const end = literalEnd(html, start);
    if (end > 0) return JSON.parse(html.slice(start, end));
    throw new FetchError(`window.${name} not terminated`);
  }
  // html_json_key: scan JSON script blocks (e.g. __NEXT_DATA__) for the key.
  const key = String(source.config.jsonKey);
  for (const m of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)) {
    const body = m[1]!.trim();
    // Flight payloads carry the key escaped inside a string (\"items\").
    if (!body.includes(`"${key}"`) && !body.includes(`\\"${key}\\"`)) continue;
    const candidates = [body, body.replace(/^[^{[]*/, "").replace(/;?\s*$/, "")];
    for (const c of candidates) {
      try {
        const parsed = JSON.parse(c);
        const found = findKey(parsed, key);
        if (found) return { [key]: found };
      } catch {
        // Next.js flight payloads: self.__next_f.push([1,"..."])
      }
    }
    const flight = /"((?:[^"\\]|\\.)*)"\]\)\s*$/.exec(body);
    if (flight) {
      try {
        const decoded = JSON.parse(`"${flight[1]}"`) as string;
        // The key's own array, up to its matching bracket: its items may hold arrays of their own.
        const at = new RegExp(`"${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\s*:\\s*\\[`).exec(decoded);
        const start = at ? at.index + at[0].length - 1 : -1;
        const end = start < 0 ? -1 : literalEnd(decoded, start);
        if (end > 0) return { [key]: JSON.parse(decoded.slice(start, end)) };
      } catch {
        // keep scanning
      }
    }
  }
  throw new FetchError(`embedded key ${key} not found`);
}

/**
 * Body HTML from a per-item JSON document (`bodyUrlTemplate` + `bodyPath`). Empty text (a picture
 * of the announcement, with no words) and a failed read leave no body. One miss does not fail the
 * listing; the entry is then recorded unconfirmed instead of fetching the article page.
 */
async function jsonDetailBody(c: SourceRow["config"], item: unknown, pageUrl: string, headers: Record<string, string>): Promise<{ html: string; text: string } | null> {
  if (!c.bodyUrlTemplate || !c.bodyPath) return null;
  const bodyUrl = renderTemplate(String(c.bodyUrlTemplate), item);
  if (!bodyUrl) return null;
  try {
    await paceHost(bodyUrl, Number(c.minRequestGapMs) || 0);
    const detail = JSON.parse(requireOk(await fetchListing(bodyUrl, { redirectPolicy: "same-origin", headers, timeoutMs: 15_000 })).text());
    const field = getPath(detail, String(c.bodyPath));
    if (typeof field !== "string" || !field.trim()) return null;
    const html = sanitizeBody(field, pageUrl);
    const text = collapseWhitespace(stripTags(html));
    return text ? { html, text } : null;
  } catch {
    return null;
  }
}

/** The mp4 for a Tencent vid, or null when getinfo has no playable file. One miss does not fail the list. */
async function tencentPlayUrl(c: SourceRow["config"], item: unknown, headers: Record<string, string>): Promise<string | null> {
  if (!c.videoVidPath || !c.videoInfoUrlTemplate) return null;
  const infoUrl = renderTemplate(String(c.videoInfoUrlTemplate), item);
  if (!infoUrl) return null;
  try {
    await paceHost(infoUrl, Number(c.minRequestGapMs) || 0);
    // Referer is what the player sends. It is not a secret; a cross-origin redirect is still refused.
    const text = requireOk(await fetchListing(infoUrl, {
      redirectPolicy: "same-origin",
      headers: { ...headers, accept: "application/json,text/plain,*/*;q=0.8", referer: "https://v.qq.com/" },
      timeoutMs: 15_000,
    })).text();
    return tencentPlayableMp4(text);
  } catch {
    return null;
  }
}

export async function fetchJsonList(source: SourceRow): Promise<Candidate[]> {
  const c = source.config;
  const url = String(c.url ?? "");
  const headers: Record<string, string> = { accept: "application/json, text/html;q=0.9", ...languageHeaders(c.acceptLanguage), ...(c.headers ?? {}) };
  if (/^https:\/\/api\.github\.com\//.test(url)) {
    const token = credential("collectors", "GITHUB_TOKEN");
    if (token) headers.authorization = `Bearer ${token}`;
  }
  await paceHost(url, Number(c.minRequestGapMs) || 0);
  const embedded = c.mode === "html_json_key" || c.mode === "html_window_var";
  // A page that blocks our addresses can be read through Jina's rendered HTML, which keeps its scripts.
  const text = embedded && url.startsWith(JINA_PREFIX)
    ? (await jinaRead(url.slice(JINA_PREFIX.length), { purpose: "source_listing", subject: `source:${source.id}`, format: "html", perRead: true })).markdown
    : requireOk(await fetchListing(url, {
      redirectPolicy: "same-origin",
      method: c.method ?? "GET",
      headers: c.bodyJson ? { ...headers, "content-type": "application/json" } : headers,
      body: c.bodyJson ? JSON.stringify(c.bodyJson) : undefined,
      timeoutMs: 25_000,
    })).text();
  let data: unknown;
  if (embedded) data = embeddedJson(text, source);
  else {
    try {
      data = JSON.parse(text);
    } catch {
      throw new FetchError("response is not JSON");
    }
  }
  let items = c.itemsPath ? getPath(data, c.itemsPath) : c.jsonKey ? getPath(data, c.jsonKey) : data;
  if (c.itemsObjectValues && items && typeof items === "object" && !Array.isArray(items)) items = Object.values(items);
  if (!Array.isArray(items)) throw new FetchError("items path did not resolve to an array");
  if ((c.bodyUrlTemplate && !c.bodyPath) || (c.bodyPath && !c.bodyUrlTemplate)) throw new FetchError("bodyUrlTemplate and bodyPath are set together");

  const out: Candidate[] = [];
  let mapped = 0;
  for (const item of items) {
    if (c.requireBoolean && getPath(item, c.requireBoolean.path) !== c.requireBoolean.equals) continue;
    if (c.minNumeric && !(Number(getPath(item, c.minNumeric.path)) >= Number(c.minNumeric.min))) continue;
    const title = firstString(item, c.titlePaths);
    const linkedUrl = c.urlTemplate && renderTemplate(c.urlTemplate, item);
    const url = linkedUrl || (c.urlTemplateFallback && renderTemplate(c.urlTemplateFallback, item));
    if (!title || !url) continue;
    mapped += 1;
    const published = toDate(getPath(item, c.publishedAtPath), c.publishedAtUnit, c.publishedAtUtcOffset);
    // A missing source date is not filled with the time we fetched it.
    if (c.requirePublishedAt === true && !published.publishedAt) continue;
    const externalId = c.externalIdPath ? getPath(item, c.externalIdPath) : null;
    const summary = firstString(item, c.summaryPaths);
    // A text alternate (.patch and the like) replaces a declared summary, same as RSS. The JSON
    // detail document is a different body: it still wins when summaryIsBody is off.
    const summaryIsBody = !c.detail?.bodyUrlSuffix && c.summaryIsBody === true && !!summary;
    const cover = coverImage(item, c.imagePaths);
    const playUrl = await tencentPlayUrl(c, item, headers);
    // A video entry's play page is a script player, not an article. getinfo supplies the file; a miss
    // still keeps the caption and does not open that page.
    const videoEntry = !!c.videoVidPath;
    const body = summaryIsBody || videoEntry ? null : await jsonDetailBody(c, item, url, headers);
    // A configured detail document is the body. No words there (or a failed read) is unconfirmed,
    // so a script-rendered article page is not fetched, with or without a reader key.
    // bodyUrlSuffix still needs that fetch, so it stays pending instead of unconfirmed.
    const detailConfigured = !summaryIsBody && !videoEntry && !c.detail?.bodyUrlSuffix && !!(c.bodyUrlTemplate && c.bodyPath);
    let bodyHtml = body?.html ?? null;
    let bodyText = summaryIsBody ? stripTags(summary!) : body?.text ?? null;
    // summaryIsBody is the article. A cover sits in that HTML so the page can show it; the text stays the summary.
    if (summaryIsBody && summary && !c.videoVidPath) {
      const img = cover ? `<p><img src="${escapeXml(cover.url)}" alt=""></p>` : "";
      bodyHtml = sanitizeBody(`${img}<p>${escapeXml(summary)}</p>`, url);
      bodyText = collapseWhitespace(stripTags(bodyHtml)) || stripTags(summary);
    }
    if (c.videoVidPath) {
      const tags = typeof c.videoTagPath === "string" ? tagNames(firstString(item, [c.videoTagPath]) ?? "") : [];
      const seconds = durationSeconds(item, typeof c.videoDurationPath === "string" ? c.videoDurationPath : undefined);
      const publishedRaw = c.publishedAtPath ? getPath(item, c.publishedAtPath) : null;
      const when = typeof publishedRaw === "string" ? publishedRaw.trim() : "";
      const blocks: string[] = [];
      if (playUrl) {
        const src = escapeXml(playUrl);
        const poster = cover ? ` poster="${escapeXml(cover.url)}"` : "";
        blocks.push(`<video src="${src}"${poster}><source src="${src}" type="video/mp4"></video>`);
      } else if (cover) blocks.push(`<p><img src="${escapeXml(cover.url)}" alt=""></p>`);
      if (summary && summary !== title) blocks.push(`<p>${escapeXml(summary)}</p>`);
      if (tags.length) blocks.push(`<p>标签：${escapeXml(tags.join("、"))}</p>`);
      if (when) blocks.push(`<p>发布时间：${escapeXml(when)}</p>`);
      if (seconds) blocks.push(`<p>时长：${seconds} 秒</p>`);
      blocks.push(`<p><a href="${escapeXml(url)}">官网播放页</a></p>`);
      bodyHtml = sanitizeBody(blocks.join(""), url);
      bodyText = collapseWhitespace(stripTags(bodyHtml));
    }
    const video = playUrl ? { kind: "video" as const, url: playUrl, poster: cover?.url ?? null } : null;
    out.push({
      url,
      title: collapseWhitespace(stripTags(title)),
      author: firstString(item, c.authorPaths),
      ...published,
      ...(!linkedUrl && c.publishedAtForFallbackUrl === true && published.publishedAt ? { listingDatesOriginal: true } : {}),
      excerpt: summary ? collapseWhitespace(stripTags(summary)).slice(0, 2000) : null,
      bodyHtml,
      bodyText,
      bodyStatus: summaryIsBody || body || (c.videoVidPath && bodyText) ? "ok" : detailConfigured ? "unconfirmed" : "pending",
      ...(cover || video ? { media: [...(cover ? [cover] : []), ...(video ? [video] : [])] } : {}),
      raw: { externalId: externalId ?? null },
    });
  }
  if (items.length > 0 && mapped === 0 && !c.requireBoolean && !c.minNumeric) throw new FetchError("no items mapped (check title/url paths)");
  if (c.requirePublishedAt === true && mapped > 0 && out.length === 0) throw new FetchError("no items with a publication date");
  return out;
}
