// Topic pages: which articles a topic takes, and their counts.
// Written before the code, from the ways it can go wrong:
// - a company topic takes an article about another company that only mentions it (several subjects,
//   its name nowhere in the title), or drops one about it whose title names it in English, in another
//   case, next to Chinese text, or only by a product (it is the article's only subject);
// - a Latin name matches inside another word ("Metadata" is not Meta); a headline naming a company
//   that is not a subject of the article gets in;
// - a technical-direction topic stops taking its tags;
// - withdrawn or not yet released articles appear in a list or a count;
// - an article or story page names a topic its reports do not belong to;
// - a topic without content has no page, or an unknown slug or a page past the end has one.
import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { publishArticle } from "@aihot/backend/publication/publish";
import { TOPICS, loadTopicPage, listTopicSummaries, topicsOfStory } from "@aihot/backend/publication/topics";
import { buildApp } from "../apps/api/src/app.ts";

const T = tag();
const OFFICIAL = `test-topics-official-${T}`;
const MEDIA = `test-topics-media-${T}`;
const app = await buildApp();

before(async () => {
  await sql`INSERT INTO sources (id, name, kind, tier, participation_mode, first_party, next_fetch_at) VALUES
    (${OFFICIAL}, 'Official', 'rss', 'T1', 'editorial', true, '2100-01-01'),
    (${MEDIA}, 'Media', 'rss', 'T2', 'editorial', false, '2100-01-01')`;
});
after(async () => {
  await app.close();
  await stopBoss();
  await closeDb();
});

let n = 0;
interface Report {
  source?: string;
  at: Date;
  title: string;
  originalTitle?: string;
  subjects?: string[];
  tags?: string[];
  score?: number;
  selected?: boolean;
  fact?: number;
  category?: string;
}

/** A published report; `fact` links it to a fact before publishing, as grouping would. */
async function report(r: Report): Promise<string> {
  n += 1;
  const { articleId } = await upsertMaterial({
    sourceId: r.source ?? MEDIA, url: `https://example.com/topics-${T}-${n}`, title: r.originalTitle ?? r.title, bodyText: "body", bodyHtml: "<p>body</p>", bodyStatus: "ok", via: "fetch", publishedAt: r.at,
  });
  await sql`UPDATE articles SET discovered_at = ${r.at}, timeline_at = ${r.at}, grouped_at = now() WHERE id = ${articleId}`;
  await sql`INSERT INTO analyses (article_id, input_revision, origin, relevance, category, title_zh, summary_zh, score, selected, subjects, tags)
            VALUES (${articleId}, 1, 'rule', 'pass', ${r.category ?? "patch"}, ${r.title}, ${`摘要 ${n}`}, ${r.score ?? 80}, ${r.selected ?? true}, ${r.subjects ?? []}, ${[r.category === "event" ? "活动" : r.category === "guide" ? "攻略教学" : r.category === "official" ? "官方公告" : r.category === "esports" ? "赛事" : r.category === "loadout" ? "改枪方案" : "版本更新", ...(r.tags ?? [])]})`;
  if (r.fact) await sql`INSERT INTO fact_articles (fact_id, article_id, role) VALUES (${r.fact}, ${articleId}, 'report')`;
  await publishArticle(articleId, { releasedAt: new Date(r.at.getTime() + 60_000) });
  return articleId;
}

async function story(title: string): Promise<{ id: number; publicId: string }> {
  const publicId = randomUUID();
  const [s] = await sql<{ id: number }[]>`INSERT INTO stories (public_id, title, first_report_at, latest_at) VALUES (${publicId}, ${title}, now(), now()) RETURNING id`;
  return { id: s!.id, publicId };
}

async function fact(storyId: number | null, title: string): Promise<number> {
  const [f] = await sql<{ id: number }[]>`INSERT INTO facts (public_id, story_id, title) VALUES (${`f-${T}-${randomUUID()}`}, ${storyId}, ${title}) RETURNING id`;
  return f!.id;
}

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000);
const ids = (items: Array<{ id: string }>) => items.map((i) => i.id);
const page = async (slug: string, p = 1) => {
  const data = await loadTopicPage(slug, p, new Date());
  assert.ok(data, `${slug} page ${p}`);
  return data;
};
/** Every article of a topic, over all its pages. */
async function members(slug: string): Promise<string[]> {
  const first = await page(slug);
  const out = ids(first.items);
  for (let p = 2; p <= first.pageCount; p++) out.push(...ids((await page(slug, p)).items));
  return out;
}

test("a company topic takes the articles about it, not the ones that only mention it", async () => {
  const about = await report({ at: hoursAgo(30), title: `GTI 新赛季上线 ${T}`, subjects: ["delta-force"] });
  const product = await report({ at: hoursAgo(31), title: `三角洲行动 赛季更新 ${T}`, subjects: ["delta-force"] });
  const english = await report({ at: hoursAgo(32), title: `新赛季 ${T}`, originalTitle: `Delta Force launches a season ${T}`, subjects: ["delta-force", "timi"] });
  const subpoena = await report({ at: hoursAgo(33), title: `天美工作室群公布封禁名单 ${T}`, subjects: ["timi", "delta-force", "team-jade"] });
  const lowerCase = await report({ at: hoursAgo(34), title: `timi 公布安全框架 ${T}`, subjects: ["timi", "delta-force"] });
  const pact = await report({ at: hoursAgo(35), title: `多家厂商签署安全协议 ${T}`, subjects: ["timi", "delta-force", "team-jade"] });
  const metadata = await report({ at: hoursAgo(36), title: `Jadeite 标准发布 ${T}`, subjects: ["team-jade", "timi"] });
  const adjacent = await report({ at: hoursAgo(37), title: `发布Jade的新版本 ${T}`, subjects: ["team-jade", "timi"] });
  const headline = await report({ at: hoursAgo(38), title: `三角洲行动 被一篇盘点提到 ${T}`, subjects: ["team-jade"] });
  const agent = await report({ at: hoursAgo(39), title: `烽火地带新点位 ${T}`, tags: ["烽火地带"] });

  const game = await members("delta-force");
  for (const id of [about, product, english]) assert.ok(game.includes(id), "about Delta Force");
  for (const id of [subpoena, lowerCase, pact, headline]) assert.ok(!game.includes(id), "only mentions Delta Force");
  const studio = await members("timi");
  for (const id of [subpoena, lowerCase]) assert.ok(studio.includes(id), "about TiMi");
  for (const id of [english, pact]) assert.ok(!studio.includes(id), "only mentions TiMi");
  const jade = await members("team-jade");
  assert.ok(jade.includes(adjacent), "Jade next to Chinese text");
  assert.ok(!jade.includes(metadata), "Jadeite is not Jade");
  assert.ok((await members("operations")).includes(agent), "a mode topic takes its tag");

  // The article page names the topics it belongs to.
  const topicsOf = async (id: string) => {
    const res = await app.inject({ method: "GET", url: `/api/site/items/${id}` });
    return (JSON.parse(res.body) as { topics: Array<{ slug: string }> }).topics.map((t) => t.slug);
  };
  assert.deepEqual(await topicsOf(about), ["delta-force", "versions"]);
  assert.deepEqual(await topicsOf(subpoena), ["timi", "versions"]);
  assert.deepEqual(await topicsOf(pact), ["versions"]);
  assert.deepEqual(await topicsOf(agent), ["operations", "versions"]);
});

test("a story page names the topics of its reports", async () => {
  const launch = await story(`烽火地带新地图 ${T}`);
  await report({ source: OFFICIAL, at: hoursAgo(26), title: `烽火地带新地图 ${T}`, tags: ["烽火地带"], fact: await fact(launch.id, "开放新地图") });
  assert.deepEqual(await topicsOfStory(launch.id), [{ slug: "operations", name: "烽火地带" }, { slug: "versions", name: "版本更新" }]);
});

test("withdrawn articles stay out of lists and counts", async () => {
  const kept = await report({ at: hoursAgo(5), title: `攻略保留 ${T}`, tags: ["攻略教学"] });
  const withdrawn = await report({ at: hoursAgo(4), title: `攻略撤回 ${T}`, tags: ["攻略教学"] });
  await sql`UPDATE publications SET visibility = 'withdrawn' WHERE article_id = ${withdrawn}`;

  const data = await page("guides");
  assert.deepEqual(ids(data.items), [kept]);
  assert.equal(data.topic.total, 1);
  const summary = (await listTopicSummaries()).topics.find((t) => t.slug === "guides")!;
  assert.equal(summary.latest?.title, `攻略保留 ${T}`, "the index shows the newest public article");
});

test("every topic has a page; unknown topics and pages past the end have none", async () => {
  const empty = await page("maps");
  assert.equal(empty.topic.indexable, false, "a topic without content is not indexed");
  assert.deepEqual(empty.items, []);
  assert.equal(await loadTopicPage("not-a-topic", 1, new Date()), null);
  assert.equal(await loadTopicPage("maps", 2, new Date()), null);
  const index = await app.inject({ method: "GET", url: "/api/site/topics" });
  const body = JSON.parse(index.body) as { groups: Array<{ key: string }>; topics: Array<{ slug: string }> };
  assert.deepEqual(body.groups.map((g) => g.key), ["company", "field", "genre"]);
  assert.deepEqual(body.topics.map((t) => t.slug).sort(), TOPICS.map((t) => t.slug).sort(), "the index lists every topic");
});
