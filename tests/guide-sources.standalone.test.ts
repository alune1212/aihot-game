// Official video lists and the two guide pages, parsed from the markup and JSON they returned
// on 2026-11-05. A video body is the player's mp4 plus the list's own caption, not the player page.
// Guide items without a source date are dropped. Two days of 每日密码 stay two articles.
import "./setup.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { config } from "@aihot/backend/config";
import { pageFetchable, readable } from "@aihot/backend/content/extract";
import { waitsForPage } from "@aihot/backend/editorial/analyze";
import { promptText } from "@aihot/backend/editorial/prompts";
import { missingEvidence } from "@aihot/backend/editorial/writing";
import { unsupportedConfig } from "@aihot/backend/sources/config-keys";
import { fetchJsonList, tencentPlayableMp4 } from "@aihot/backend/sources/json-list";
import { fetchWebList } from "@aihot/backend/sources/web-list";
import { identityKeyForUrl } from "@aihot/backend/lib/url";

const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/sources");
const read = (name: string) => readFileSync(path.join(fixtureDir, name), "utf8");
const guidesJson = read("df-video-guides.json");
const devlogJson = read("df-video-devlog.json");
const aliHtml = read("ali213-newgl.html");
const dmHtml = read("3dm-gl.html");
const pack = JSON.parse(readFileSync(path.join(fixtureDir, "../../../industry/sources.json"), "utf8")) as {
  sources: Array<{ id: string; kind: "json_list" | "web_list"; site_fulltext?: boolean; config: Record<string, unknown> }>;
};
const packed = (id: string) => {
  const source = pack.sources.find((item) => item.id === id);
  assert.ok(source, id);
  return source;
};

const seen: Array<{ path: string; referer?: string }> = [];
const pages: Record<string, () => string> = {
  "/guides.json": () => guidesJson,
  "/devlog.json": () => devlogJson,
  "/same.json": () => {
    const data = JSON.parse(guidesJson) as { jData: { data: { items: unknown[] } } };
    data.jData.data.items = [data.jData.data.items[0]];
    return JSON.stringify(data);
  },
  "/undated.json": () => {
    const data = JSON.parse(guidesJson) as { jData: { data: { items: Array<Record<string, string>> } } };
    data.jData.data.items[1]!.sIdxTime = "";
    data.jData.data.items.push({ ...data.jData.data.items[0]!, sTitle: "没有日期的视频", sIdxTime: "  ", sVID: "nodate", iDocID: "1" });
    return JSON.stringify(data);
  },
  "/ali.html": () => aliHtml,
  "/ali-undated.html": () => aliHtml.replace("2026-11-03 09:45:26", "日期不详"),
  "/3dm.html": () => dmHtml,
};
const server = http.createServer((req, res) => {
  const url = req.url ?? "";
  seen.push({ path: url, referer: req.headers.referer });
  if (url.startsWith("/getinfo-fail")) {
    res.writeHead(500, { "content-type": "text/plain" });
    return res.end("down");
  }
  if (url.startsWith("/getinfo")) {
    const vid = new URL(url, "http://fixture.local").searchParams.get("vids") ?? "clip";
    const payload = { em: 0, vl: { vi: [{ drm: 0, fn: `${vid}.mp4`, fvkey: "KEY1", ul: { ui: [{ url: "http://203.0.113.5/vhot2.qqvideo.tc.qq.com/room/" }] } }] } };
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    return res.end(`QZOutputJson=${JSON.stringify(payload)};`);
  }
  const body = Object.hasOwn(pages, url) ? pages[url] : undefined;
  res.writeHead(body ? 200 : 404, { "content-type": url.endsWith(".json") ? "application/json" : "text/html; charset=utf-8" });
  res.end(body ? body() : "");
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
const site = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
const previousPrivate = config.allowPrivateNetworkFetch;
config.allowPrivateNetworkFetch = true;
after(() => {
  config.allowPrivateNetworkFetch = previousPrivate;
  return new Promise<void>((resolve) => server.close(() => resolve()));
});

const row = (config: Record<string, unknown>) => ({ id: "fixture", config }) as never;
const videoConfig = (id: string, url: string, info?: string) => ({
  ...packed(id).config, url, minRequestGapMs: 0,
  videoInfoUrlTemplate: info ?? `${site}/getinfo?vids={raw:sVID}`,
});

test("the new source configs are ones these collectors implement", () => {
  for (const id of ["df-official-video-guides", "df-official-videos", "df-official-devlog", "df-ali213-guides", "df-3dm-guides"]) {
    const source = packed(id);
    assert.deepEqual(unsupportedConfig(source.kind, source.config), [], id);
  }
  assert.deepEqual(unsupportedConfig("json_list", { imagePaths: [1], minRequestGapMs: 1.5, requirePublishedAt: "yes" }), ["imagePaths", "minRequestGapMs", "requirePublishedAt"]);
    assert.deepEqual(unsupportedConfig("web_list", { requirePublishedAt: true, minRequestGapMs: 2000 }), ["minRequestGapMs"]);
  assert.equal(packed("df-ali213-guides").site_fulltext, true);
  assert.equal(packed("df-3dm-guides").site_fulltext, true);
});

test("official video items keep a playable page, a dated blurb and a cover, and skip undated rows", async () => {
  const guides = await fetchJsonList(row(videoConfig("df-official-video-guides", `${site}/guides.json`)));
  assert.equal(seen.find((hit) => hit.path === "/guides.json")?.referer, "https://df.qq.com/");
  assert.equal(guides.length, 3);
  assert.equal(guides[0]!.title, "全面战场UE5规格地图【天际港】，11月5日，破浪登陆！");
  assert.equal(guides[0]!.publishedAt?.toISOString(), "2026-11-02T07:55:18.000Z");
  assert.equal(guides[0]!.bodyStatus, "ok");
  assert.equal(seen.find((hit) => hit.path.startsWith("/getinfo"))?.referer, "https://v.qq.com/");
  const file = "https://vhot2.qqvideo.tc.qq.com/room/v33716oedb4.mp4?vkey=KEY1";
  assert.match(guides[0]!.bodyHtml ?? "", new RegExp(`<video[^>]*src="${file.replace(/[?]/g, "\\?")}"`));
  assert.match(guides[0]!.bodyHtml ?? "", /<source [^>]*type="video\/mp4"/);
  assert.doesNotMatch(guides[0]!.bodyHtml ?? "", /<iframe/);
  assert.match(guides[0]!.bodyText ?? "", /【天际港】 \| UE5规格呈现/);
  assert.match(guides[0]!.bodyText ?? "", /标签：视频、新官网视频、宣传短片/);
  assert.match(guides[0]!.bodyText ?? "", /发布时间：2026-11-02 15:55:18/);
  assert.match(guides[0]!.bodyText ?? "", /时长：155 秒/);
  assert.match(guides[0]!.bodyText ?? "", /官网播放页/);
  assert.ok((guides[0]!.bodyText ?? "").length > 80, guides[0]!.bodyText ?? "");
  assert.equal(guides[0]!.media?.[0]?.url, "https://static.gametalk.qq.com/image/423/1793605699_4a47a0db6e60853dedfcfdf08a5ca249.png");
  assert.equal(guides[0]!.media?.[1]?.url, file);
  const play = new URL(guides[0]!.url);
  assert.equal(play.origin + play.pathname, "https://df.qq.com/cp/a20240906main/videodetail.html");
  assert.equal(play.searchParams.get("id"), "v33716oedb4");
  assert.equal(play.searchParams.get("idocId"), "1970542675728584910");
  assert.equal(play.searchParams.has("chanid"), false);
  assert.equal(play.searchParams.has("totalPlay"), false);
  assert.equal(play.searchParams.has("creatTime"), false);
  assert.equal(play.searchParams.has("title"), false);
  const judged = { bodyStatus: guides[0]!.bodyStatus, bodyText: guides[0]!.bodyText, excerpt: guides[0]!.excerpt, xPost: null, url: guides[0]!.url, source: { kind: "json_list" } };
  assert.equal(missingEvidence(judged as never), false);
  assert.equal(waitsForPage(judged as never), false);
  assert.equal(pageFetchable(guides[0]!.url, "json_list"), true);

  const devlog = await fetchJsonList(row(videoConfig("df-official-devlog", `${site}/devlog.json`)));
  assert.equal(devlog[0]!.title, "爱可以找到完美时间线");
  assert.equal(devlog[0]!.publishedAt?.toISOString(), "2026-08-20T06:50:46.000Z");
  assert.equal(devlog[0]!.bodyStatus, "ok");
  assert.equal(devlog[0]!.excerpt, devlog[0]!.title);
  assert.match(devlog[0]!.bodyText ?? "", /标签：视频、新官网视频、洲洲整活/);
  assert.match(devlog[0]!.bodyText ?? "", /发布时间：2026-08-20 14:50:46/);
  assert.match(devlog[0]!.bodyText ?? "", /时长：212 秒/);
  assert.doesNotMatch(devlog[0]!.bodyHtml ?? "", /<iframe/);
  assert.ok(devlog[0]!.media?.[0]?.url.startsWith("https://static.gametalk.qq.com/"));
  const missed = await fetchJsonList(row(videoConfig("df-official-devlog", `${site}/devlog.json`, `${site}/getinfo-fail`)));
  assert.equal(missed[0]!.bodyStatus, "ok");
  assert.doesNotMatch(missed[0]!.bodyHtml ?? "", /<video/);
  assert.match(missed[0]!.bodyText ?? "", /发布时间：2026-08-20 14:50:46/);
  assert.equal(seen.some((hit) => hit.path.includes("videodetail")), false);

  const dated = await fetchJsonList(row(videoConfig("df-official-video-guides", `${site}/undated.json`)));
  assert.deepEqual(dated.map((item) => item.title), [guides[0]!.title, guides[2]!.title]);

  const again = await fetchJsonList(row(videoConfig("df-official-videos", `${site}/same.json`)));
  assert.equal(again[0]!.url, guides[0]!.url);
  assert.equal(identityKeyForUrl(again[0]!.url), identityKeyForUrl(guides[0]!.url));
});

test("游侠网 and 3DM lists keep the page's own time, and a day of 每日密码 is its own article", async () => {
  const ali = packed("df-ali213-guides");
  const aliItems = await fetchWebList(row({ ...ali.config, url: `${site}/ali.html`, baseUrl: ali.config.url }));
  assert.deepEqual(aliItems.map((item) => [item.title, item.publishedAt?.toISOString(), item.url]), [
    ["《三角洲行动》S12赛季3x3任务总览", "2026-11-05T01:31:35.000Z", "https://gl.ali213.net/html/2026-11/1822469.html"],
    ["《三角洲行动》S12全干员平衡性调整一览", "2026-11-03T01:45:26.000Z", "https://gl.ali213.net/html/2026-11/1821729.html"],
    ["《三角洲行动》S12武器平衡性调整一览", "2026-11-03T01:33:31.000Z", "https://gl.ali213.net/html/2026-11/1821717.html"],
  ]);
  const aliDated = await fetchWebList(row({ ...ali.config, url: `${site}/ali-undated.html`, baseUrl: ali.config.url }));
  assert.deepEqual(aliDated.map((item) => item.title), [aliItems[0]!.title, aliItems[2]!.title]);

  const dm = packed("df-3dm-guides");
  const dmItems = await fetchWebList(row({ ...dm.config, url: `${site}/3dm.html`, baseUrl: dm.config.url }));
  assert.deepEqual(dmItems.map((item) => [item.title, item.publishedAt?.toISOString(), item.url]), [
    ["三角洲行动每日密码2026.11.5", "2026-11-05T01:06:31.000Z", "https://ol.3dmgame.com/gl/358066.html"],
    ["三角洲行动每日密码2026.11.4", "2026-11-04T01:02:59.000Z", "https://ol.3dmgame.com/gl/357912.html"],
    ["三角洲行动S12赛季M250磐石供弹弹舱效果介绍", "2026-11-03T06:32:59.000Z", "https://ol.3dmgame.com/gl/357875.html"],
  ]);
  assert.notEqual(identityKeyForUrl(dmItems[0]!.url), identityKeyForUrl(dmItems[1]!.url));
  assert.notEqual(dmItems[0]!.publishedAt?.toISOString(), dmItems[1]!.publishedAt?.toISOString());
});

test("a drm file is not embedded, and a short 3DM page keeps its picture without the app gate", () => {
  const drm = `QZOutputJson=${JSON.stringify({ vl: { vi: [{ drm: 1, fn: "a.mp4", fvkey: "K", ul: { ui: [{ url: "http://203.0.113.5/vhot2.qqvideo.tc.qq.com/room/" }] } }] } })};`;
  assert.equal(tencentPlayableMp4(drm), null);
  const got = readable(read("3dm-357871.html"), "https://ol.3dmgame.com/gl/357871.html");
  assert.ok(got);
  assert.match(got.text, /拥有5级穿透水平的穿甲弹/);
  assert.match(got.html, /1793686895_636286\.png/);
  assert.doesNotMatch(got.text, /扫一扫下载APP/);
  assert.ok(got.text.length >= 200, String(got.text.length));
});

test("grouping instructions keep each day's 每日密码 apart", () => {
  for (const name of ["group-batch", "group-pair"]) assert.match(promptText(name), /每日密码/);
  assert.match(readFileSync(path.join(fixtureDir, "../../../industry/prompts/structure.md"), "utf8"), /每日密码/);
});
