// The site's own texts link the names of pages it has (contracts/mentions.ts): an article page, an event
// page and a report are sent the pages their texts name. Company topics are the engine's own; other pages,
// such as a model's, come from the installed modules, so a site without them still links its companies.
// Failure cases: a page a module offers is not sent; a site without modules sends a module's pages or none.
import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { installModules } from "@aihot/backend/modules";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { publishArticle } from "@aihot/backend/publication/publish";
import { loadItemDetail } from "@aihot/backend/publication/detail";
import { loadStoryDetail } from "@aihot/backend/publication/stories";
import { loadReport } from "@aihot/backend/publication/reports";
import { stopBoss } from "@aihot/backend/jobs/queue";

const T = tag();
const source = `mentions-${T}`;
const at = new Date("2026-09-30T00:00:00Z");
const extras = [{ name: "extras", mentions: async () => [{ href: "/maps/new", names: ["新撤离点"] }] }];
let sequence = 0;

before(async () => {
  await sql`INSERT INTO sources (id, name, kind, tier, participation_mode, next_fetch_at)
    VALUES (${source}, 'Mention source', 'rss', 'T1', 'editorial', '2100-01-01')`;
});
after(async () => { installModules([]); await stopBoss(); await closeDb(); });

async function article(title: string, summary: string) {
  const { articleId } = await upsertMaterial({ sourceId: source, url: `https://example.com/${T}/${++sequence}`, title,
    bodyText: "Fixture body", bodyHtml: "<p>Fixture body</p>", bodyStatus: "ok", via: "fetch", publishedAt: at });
  await sql`UPDATE articles SET grouping_status = 'complete' WHERE id = ${articleId}`;
  await sql`INSERT INTO analyses (article_id, input_revision, origin, relevance, category, title_zh, summary_zh, score, selected)
    VALUES (${articleId}, 1, 'rule', 'pass', 'industry', ${title}, ${summary}, 90, true)`;
  await publishArticle(articleId, { releasedAt: at });
  return articleId;
}

const hrefs = (mentions: Array<{ href: string | null }>) => mentions.map((m) => m.href);

test("an article page is sent the pages its summary names: the module's and the engine's company topics", async () => {
  const id = await article("新赛季发布", "三角洲行动开放新撤离点，接入了已有的模式。");
  installModules([]);
  const bare = await loadItemDetail(id);
  assert.equal(bare.kind, "found");
  if (bare.kind !== "found") return;
  assert.deepEqual(hrefs(bare.item.mentions), ["/topics/delta-force"], "a site without modules links its companies only");

  installModules(extras);
  const full = await loadItemDetail(id);
  if (full.kind !== "found") return assert.fail("article missing");
  assert.deepEqual(full.item.mentions, [
    { href: "/topics/delta-force", names: ["三角洲行动"] },
    { href: "/maps/new", names: ["新撤离点"] },
  ]);
});

test("an event page is sent the pages its overview names", async () => {
  installModules(extras);
  const id = await article("天美工作室群提到新撤离点", "天美工作室群提到新撤离点。");
  const [s] = await sql<{ id: number }[]>`INSERT INTO stories (public_id, title, first_report_at, latest_at) VALUES (${randomUUID()}, '天美工作室群发布说明', ${at}, ${at}) RETURNING id`;
  const [f] = await sql<{ id: number }[]>`INSERT INTO facts (public_id, story_id, title, subject, action, object) VALUES (${`f-${randomUUID()}`}, ${s!.id}, '天美工作室群发布说明', '天美工作室群', '发布', '说明') RETURNING id`;
  await sql`INSERT INTO fact_articles (fact_id, article_id, role, evidence) VALUES (${f!.id}, ${id}, 'report', 'fixture')`;
  await sql`UPDATE publications SET story_id = ${s!.id}, fact_id = ${f!.id} WHERE article_id = ${id}`;
  const story = (await loadStoryDetail(Number(s!.id), new Date(+at + 3600_000)))!;
  assert.equal(story.excerpt?.text, "天美工作室群提到新撤离点。");
  assert.deepEqual(hrefs(story.mentions), ["/topics/timi", "/maps/new"]);
});

test("a report is sent the pages its lead and summaries name", async () => {
  installModules(extras);
  const id = await article("新撤离点上线", "新撤离点上线。");
  const key = "2096-02-01";
  await sql`INSERT INTO reports (kind, key, window_start, window_end, content, generated_at, origin)
    VALUES ('daily', ${key}, ${at}, ${at}, ${sql.json({
      lead: { title: "琳琅天上发布说明", leadParagraph: "琳琅天上发布说明。" },
      sections: [{ label: "版本", items: [{ itemId: id, title: "新撤离点上线", summary: "新撤离点上线。", sourceUrl: "https://example.com", sourceName: "Mention source" }] }],
    } as never)}, ${at}, 'manual')`;
  const report = (await loadReport("daily", key))!;
  assert.deepEqual(hrefs(report.mentions), ["/topics/team-jade", "/maps/new"]);
});
