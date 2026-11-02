// Reports: a scheduled run that starts late still writes the issue it was due for, never one whose
// window is still open; a daily whose window still has unjudged articles is refused rather than published
// as a quiet day; and an older weekly that froze no summaries shows the cited articles' public summaries.
import { editionAt, tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { publishArticle } from "@aihot/backend/publication/publish";
import { loadReport } from "@aihot/backend/publication/reports";
import { composeDaily, dueDaily, dueMonthly, dueWeekly } from "@aihot/backend/reports/compose";
import { REPORTS, SITE } from "@aihot/site";

const T = tag();
const SOURCE = `test-reports-${T}`;
const WEEK = "2098-W20";
after(async () => {
  await stopBoss();
  await closeDb();
});

test("a late run writes the issue that was due, not today's", () => {
  assert.equal(dueDaily(editionAt("daily", "2026-09-29", 6)), "2026-09-29");
  assert.equal(dueDaily(editionAt("daily", "2026-09-30", -60)), "2026-09-29", "the 29th's run delayed until just before the next issue");
  assert.equal(dueWeekly(editionAt("weekly", "2026-09-28")), "2026-W39");
  assert.equal(dueWeekly(editionAt("weekly", "2026-10-05", -60)), "2026-W39", "Monday before its edition time: the next week is not due yet");
  assert.equal(dueWeekly(editionAt("weekly", "2026-10-05", 60)), "2026-W40");
  assert.equal(dueMonthly(editionAt("monthly", "2026-10-01")), "2026-09");
  assert.equal(dueMonthly(editionAt("monthly", "2026-10-01", -60)), "2026-08");
  assert.equal(dueMonthly(editionAt("monthly", "2027-01-15")), "2026-12");
});

test("a daily with an empty window is skipped, and one with unjudged articles still fails", async () => {
  const date = "2098-01-15";
  assert.equal(await composeDaily(date), null);
  const [row] = await sql`SELECT 1 FROM reports WHERE kind = 'daily' AND key = ${date}`;
  assert.equal(row, undefined);
  const pending = "2098-01-16";
  const id = `report-empty-${T}`;
  await sql`INSERT INTO sources (id, name, kind, tier, participation_mode, next_fetch_at) VALUES (${id}, 'Reports', 'rss', 'T1', 'editorial', '2100-01-01')`;
  await sql`INSERT INTO articles (id, source_id, identity_key, url, title, body_text, discovered_at, timeline_at, published_at)
    VALUES (${id}, ${id}, ${id}, ${`https://example.com/${id}`}, '待判断', 'b', '2098-01-16T00:00:00+08:00', '2098-01-16T00:00:00+08:00', '2098-01-16T00:00:00+08:00')`;
  await assert.rejects(composeDaily(pending), /nothing judged/);
  const [pendingRow] = await sql`SELECT 1 FROM reports WHERE kind = 'daily' AND key = ${pending}`;
  assert.equal(pendingRow, undefined);
});

test("finished articles judged on another clock do not fail the daily, and a scored empty window is quiet", async () => {
  const source = `report-clock-${T}`;
  await sql`INSERT INTO sources (id, name, kind, tier, participation_mode, next_fetch_at) VALUES (${source}, 'Clock', 'rss', 'T1', 'editorial', '2100-01-01')`;
  const insert = async (id: string, publishedAt: Date, timelineAt: Date, selected: boolean, score: number | null) => {
    await sql`INSERT INTO articles (id, source_id, identity_key, url, title, body_text, discovered_at, timeline_at, published_at, processing_state, grouping_status)
      VALUES (${id}, ${source}, ${id}, ${`https://example.com/${id}`}, ${id}, 'b', ${publishedAt}, ${timelineAt}, ${publishedAt}, 'analyzed', 'complete')`;
    await sql`INSERT INTO publications (article_id, title, source_id, channel, url, published_at, discovered_at, timeline_at, sort_at, eligible, selected, visible_after, visibility, score)
      VALUES (${id}, ${id}, ${source}, 'news', ${`https://example.com/${id}`}, ${publishedAt}, ${publishedAt}, ${timelineAt}, ${timelineAt}, true, ${selected}, ${selected ? timelineAt : null}, 'public', ${score})`;
  };
  // 2026-10-30's window ends 08:00. The article was published inside it and judged at 10:30, not selected.
  // 2026-11-01's window holds an article whose timeline is 2026-11-02 08:45, after that day's edition.
  const oct30End = editionAt("daily", "2026-10-30");
  await insert(`clock-a-${T}`, new Date(oct30End.getTime() - 3600_000), new Date("2026-10-30T10:30:00+08:00"), false, null);
  await insert(`clock-b-${T}`, new Date("2026-10-30T15:35:00+08:00"), new Date("2026-10-30T15:35:00+08:00"), true, 80);
  const nov1End = editionAt("daily", "2026-11-01");
  await insert(`clock-c-${T}`, new Date(nov1End.getTime() - 2 * 3600_000), new Date("2026-11-02T08:45:00+08:00"), true, 75);
  for (const key of ["2026-10-29", "2026-10-31"]) {
    await sql`INSERT INTO reports (kind, key, window_start, window_end, content, generated_at)
      VALUES ('daily', ${key}, now(), now(), ${sql.json({ date: key, lead: { title: "已有" } })}, now())`;
  }
  assert.equal(await composeDaily("2026-10-30"), null);
  assert.equal(await composeDaily("2026-11-01"), null);
  assert.equal(await composeDaily("2026-11-02"), null);
  for (const key of ["2026-10-30", "2026-11-01", "2026-11-02"]) {
    const [row] = await sql`SELECT 1 FROM reports WHERE kind = 'daily' AND key = ${key}`;
    assert.equal(row, undefined, key);
  }
  for (const key of ["2026-10-29", "2026-10-31"]) {
    const [row] = await sql<{ title: string }[]>`SELECT content->'lead'->>'title' AS title FROM reports WHERE kind = 'daily' AND key = ${key}`;
    assert.equal(row!.title, "已有");
  }

  const unscored = "2097-04-03";
  const unscoredAt = new Date(editionAt("daily", unscored).getTime() - 12 * 3600_000);
  await insert(`clock-d-${T}`, unscoredAt, unscoredAt, false, null);
  assert.equal(await composeDaily(unscored), null, "analyzed, nothing selected, no score: skip rather than retry");

  const scored = "2097-04-04";
  const scoredAt = new Date(editionAt("daily", scored).getTime() - 12 * 3600_000);
  await insert(`clock-e-${T}`, scoredAt, scoredAt, false, 40);
  assert.equal((await composeDaily(scored))?.entries, 0);
  const [issue] = await sql<{ title: string }[]>`SELECT content->'lead'->>'title' AS title FROM reports WHERE kind = 'daily' AND key = ${scored}`;
  assert.equal(issue!.title, REPORTS.quiet.title);
});

test("a weekly that froze no summaries shows the articles' public summaries", async () => {
  await sql`INSERT INTO sources (id, name, kind, tier, participation_mode, next_fetch_at) VALUES (${SOURCE}, 'Reports', 'rss', 'T1', 'editorial', '2100-01-01')`;
  // Found, published and released a minute ago: a rolling window that ends at the reader's clock holds it.
  const minuteAgo = new Date(Date.now() - 60_000);
  const { articleId } = await upsertMaterial({ sourceId: SOURCE, url: `https://example.com/${T}`, title: `R ${T}`, bodyText: "b", bodyHtml: "<p>b</p>", bodyStatus: "ok", via: "fetch", publishedAt: minuteAgo, discoveredAt: minuteAgo });
  await sql`INSERT INTO analyses (article_id, input_revision, origin, relevance, category, title_zh, summary_zh, score, selected)
            VALUES (${articleId}, 1, 'rule', 'pass', 'industry', ${`标题-${T}`}, ${`公开摘要-${T}`}, 80, true)`;
  await publishArticle(articleId, { releasedAt: minuteAgo });
  const content = { kind: "weekly", title: `${SITE.name} 周报 · ${WEEK}`, overview: "o", themes: [{ heading: "h", summary: "s", storyRefs: [{ itemId: articleId, title: `标题-${T}`, sourceName: "Old aggregator", sourceId: "old-source", firstParty: false, sourceUrl: "https://example.com" }] }] };
  await sql`INSERT INTO reports (kind, key, window_start, window_end, content, generated_at, origin)
            VALUES ('weekly', ${WEEK}, now(), now(), ${sql.json(content as never)}, now(), 'imported')`;
  const report = await loadReport("weekly", WEEK);
  assert.equal(report?.sections[0]?.items[0]?.summary, `公开摘要-${T}`);
  assert.equal(report?.sections[0]?.items[0]?.sourceName, "Reports");
  assert.equal(report?.sections[0]?.items[0]?.firstParty, true, "a frozen citation cannot override verified current provenance");
  await sql`UPDATE sources SET tier = 'T1_5', first_party = true WHERE id = ${SOURCE}`;
  await publishArticle(articleId);
  assert.equal((await loadReport("weekly", WEEK))?.sections[0]?.items[0]?.firstParty, false);
});
