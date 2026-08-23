import { prisma } from '../config/prisma.js';
import { runDocumentExpiryReminders } from '../services/documentExpiryReminderService.js';
import { refreshExternalJobs } from '../services/externalJobs/refresh.js';

/**
 * Single entrypoint for the one Render Cron Job this project runs: document-
 * expiry reminder emails, then the external-jobs refresh.
 *
 * Both run even if one throws — an email outage must not stop the jobs pool
 * from refreshing, and vice versa — and the process exits non-zero if either
 * failed, so Render still flags the run instead of the failure hiding behind
 * the other job's success.
 *
 *   npm run job:daily
 *   npm run job:daily:prod   (compiled, for the scheduler)
 *   npm run job:daily -- --dry-run   (logs what would send/refresh; no emails, no DB writes)
 */
async function main() {
  const dryRun = process.argv.includes('--dry-run');
  let failed = false;

  console.log(
    `[daily-jobs] starting${dryRun ? ' (dry run)' : ''} at ${new Date().toISOString()}`,
  );

  try {
    console.log('[daily-jobs] running expiry-reminders...');
    const result = await runDocumentExpiryReminders({ dryRun });
    console.log(
      `[daily-jobs] expiry-reminders: scanned ${result.documentsScanned} document(s); ` +
        `notified ${result.professionalsNotified} professional(s); ` +
        `${result.emailsFailed} failed`,
    );
    if (result.emailsFailed > 0) failed = true;
  } catch (error) {
    console.error('[daily-jobs] expiry-reminders crashed:', error);
    failed = true;
  }

  try {
    console.log('[daily-jobs] running external-jobs refresh...');
    const summary = await refreshExternalJobs();
    console.log(
      `[daily-jobs] external-jobs refresh: ran ${summary.queriesRun} search(es) (${summary.quotaNote}); ` +
        `stored ${summary.jobsStored} listing(s); removed ${summary.staleRemoved} stale`,
    );
  } catch (error) {
    console.error('[daily-jobs] external-jobs refresh crashed:', error);
    failed = true;
  }

  console.log(`[daily-jobs] finished at ${new Date().toISOString()}`);
  if (failed) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error('[daily-jobs] run failed', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
