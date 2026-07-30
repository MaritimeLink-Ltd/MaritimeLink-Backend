import { prisma } from '../config/prisma.js';
import { runDocumentExpiryReminders } from '../services/documentExpiryReminderService.js';

/**
 * Daily document-expiry reminder job.
 *
 * Run from an external scheduler (Railway/Render cron, GitHub Actions, cloud
 * scheduler) rather than in-process, so exactly one instance fires it:
 *
 *   npm run job:expiry-reminders
 *   npm run job:expiry-reminders -- --dry-run
 *   npm run job:expiry-reminders -- --only someone@example.com
 */
async function main() {
  const dryRun = process.argv.includes('--dry-run');

  const onlyFlagIndex = process.argv.indexOf('--only');
  const onlyEmail =
    onlyFlagIndex !== -1 ? process.argv[onlyFlagIndex + 1] : undefined;

  if (onlyFlagIndex !== -1 && !onlyEmail) {
    console.error('[expiry-reminders] --only requires an email address');
    process.exitCode = 1;
    return;
  }

  const startedAt = Date.now();

  console.log(
    `[expiry-reminders] starting${dryRun ? ' (dry run)' : ''}` +
      `${onlyEmail ? ` (only ${onlyEmail})` : ''} at ${new Date().toISOString()}`,
  );

  const result = await runDocumentExpiryReminders({ dryRun, onlyEmail });

  console.log(
    `[expiry-reminders] scanned ${result.documentsScanned} document(s); ` +
      `notified ${result.professionalsNotified} professional(s) ` +
      `covering ${result.documentsReminded} document(s); ` +
      `${result.emailsFailed} failed; ` +
      `took ${Date.now() - startedAt}ms`,
  );

  // Surface delivery problems to the scheduler so a failed run is visible.
  if (result.emailsFailed > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error('[expiry-reminders] run failed', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
