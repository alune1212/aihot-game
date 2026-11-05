// 预览过季改枪码会删多少、按来源怎么分布。默认不删。
//   node --env-file-if-exists=.env modules/loadouts/scripts/cleanup.ts
//   node --env-file-if-exists=.env modules/loadouts/scripts/cleanup.ts --apply
import { closeDb } from "@aihot/backend/db";
import { cleanupOutOfSeason } from "../cleanup.ts";

const apply = process.argv.includes("--apply");
try {
  const plan = await cleanupOutOfSeason({ dryRun: !apply });
  console.log(JSON.stringify({
    skipped: plan.skipped,
    dryRun: plan.dryRun,
    count: plan.ids.length,
    deleted: plan.deleted,
    bySource: plan.bySource,
    retiredDelta: plan.retiredDelta,
  }, null, 2));
} finally {
  await closeDb();
}
