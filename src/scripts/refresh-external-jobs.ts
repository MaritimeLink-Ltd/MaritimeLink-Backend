import { prisma } from '../config/prisma.js';
import { refreshExternalJobs } from '../services/externalJobs/refresh.js';

/**
 * Daily external-jobs refresh (SerpApi + JSearch + syndicated maritime feeds).
 *
 * Run from an external scheduler (Render cron, GitHub Actions, cloud
 * scheduler) rather than in-process, so exactly one instance fires it — same
 * pattern as job:expiry-reminders:
 *
 *   npm run job:refresh-external-jobs
 *   npm run job:refresh-external-jobs:prod   (compiled, for the scheduler)
 */
async function main() {
  const startedAt = Date.now();
  console.log(`[external-jobs] starting at ${new Date().toISOString()}`);

  const summary = await refreshExternalJobs();

  console.log(
    `[external-jobs] SerpApi ran ${summary.serpApiQueriesRun} search(es) (${summary.serpApiQuotaNote}); ` +
      `JSearch ran ${summary.jSearchQueriesRun} search(es) (${summary.jSearchNote}); ` +
      `stored ${summary.jobsStored} listing(s); ` +
      `removed ${summary.staleRemoved} stale listing(s); ` +
      `took ${Date.now() - startedAt}ms`,
  );
}

main()
  .catch((error) => {
    console.error('[external-jobs] run failed', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
