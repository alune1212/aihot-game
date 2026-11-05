// Official video lists and the two guide pages, parsed from the markup and JSON they returned
// on 2026-11-05. A video with no article text keeps the API blurb (or the title) and its cover,
// so the body job does not open the player page and record a failed extract. Guide items without
// a source date are dropped. Two days of 每日密码 stay two articles.
import "./setup.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { config } from "@aihot/backend/config";
import { pageFetchable } from "@aihot/backend/content/extract";
import { waitsForPage } from "@aihot/backend/editorial/analyze";
import { promptText } from "@aihot/backend/editorial/prompts";
import { missingEvidence } from "@aihot/backend/editorial/writing";
import { unsupportedConfig } from "@aihot/backend/sources/config-keys";
import { fetchJsonList } from "@aihot/backend/sources/json-list";
import { fetchWebList } from "@aihot/backend/sources/web-list";
import { identityKeyForUrl } from "@aihot/backend/lib/url";

const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/sources");
const read = (name: string) => readFileSync(path.join(fixtureDir, name), "utf8");
const guidesJson = read("df-video-guides.json");
const devlogJson = read("df-video-devlog.json");
const aliHtml = read("ali213-newgl.html");
const dmHtml = read("3dm-gl.html");
const pack = JSON.parse(readFileSync(path.join(fixtureDir, "../../../industry/sources.json"), "utf8")) as {
  sources: Array<{ id: string; kind: "json_list" | "web_list"; config: Record<string, unknown> }>;
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
const videoConfig = (id: string, url: string) => ({ ...packed(id).config, url, minRequestGapMs: 0 });

test("the new source configs are ones these collectors implement", () => {
  for (const id of ["df-official-video-guides", "df-official-videos", "df-official-devlog", "df-ali213-guides", "df-3dm-guides"]) {
    const source = packed(id);
    assert.deepEqual(unsupportedConfig(source.kind, source.config), [], id);
  }
  assert.deepEqual(unsupportedConfig("json_list", { imagePaths: [1], minRequestGapMs: 1.5, requirePublishedAt: "yes" }), ["imagePaths", "minRequestGapMs", "requirePublishedAt"]);
  assert.deepEqual(unsupportedConfig("web_list", { requirePublishedAt: true, minRequestGapMs: 2000 }), ["minRequestGapMs"]);
});

test("official video items keep a playable page, a dated blurb and a cover, and skip undated rows", async () => {
  const guides = await fetchJsonList(row(videoConfig("df-official-video-guides", `${site}/guides.json`)));
  assert.equal(seen.find((hit) => hit.path === "/guides.json")?.referer, "https://df.qq.com/");
  assert.equal(guides.length, 3);
  assert.equal(guides[0]!.title, "全面战场UE5规格地图【天际港】，11月5日，破浪登陆！");
  assert.equal(guides[0]!.publishedAt?.toISOString(), "2026-11-02T07:55:18.000Z");
  assert.equal(guides[0]!.bodyStatus, "ok");
  assert.equal(guides[0]!.bodyText, "【天际港】 | UE5规格呈现");
  assert.match(guides[0]!.bodyHtml ?? "", /<img src="https:\/\/static\.gametalk\.qq\.com\/image\/423\/1793605699_4a47a0db6e60853dedfcfdf08a5ca249\.png"/);
  assert.equal(guides[0]!.media?.[0]?.url, "https://static.gametalk.qq.com/image/423/1793605699_4a47a0db6e60853dedfcfdf08a5ca249.png");
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
  assert.equal(devlog[0]!.bodyText, devlog[0]!.title, "an empty blurb uses the title, and is not an unconfirmed body");
  assert.equal(devlog[0]!.excerpt, devlog[0]!.title);
  assert.ok(devlog[0]!.media?.[0]?.url.startsWith("https://static.gametalk.qq.com/"));

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

test("grouping instructions keep each day's 每日密码 apart", () => {
  for (const name of ["group-batch", "group-pair"]) assert.match(promptText(name), /每日密码/);
  assert.match(readFileSync(path.join(fixtureDir, "../../../industry/prompts/structure.md"), "utf8"), /每日密码/);
});
