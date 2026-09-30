import { prisma } from '../config/prisma.js';
import { purgeExpiredSearchListings } from '../services/externalJobs/expiry.js';

/**
 * Permanently deletes expired external job listings, checking every link
 * rather than the daily third. The daily refresh already runs the same
 * purge; this is for an immediate full cleanup, and spends no SerpApi or
 * JSearch quota.
 *
 *   npm run job:purge-expired-jobs
 */
async function main() {
  const startedAt = Date.now();
  const summary = await purgeExpiredSearchListings({ checkAllLinks: true });
  console.log(
    `[purge-expired] deleted ${summary.total} expired listing(s): ` +
      `${summary.expiryProneRemoved} on expiry-prone sites, ${summary.tooOldRemoved} older than the age limit, ` +
      `${summary.unverifiableRemoved} undated on sites that can't be checked, ` +
      `${summary.deadLinksRemoved} with dead links (${summary.linksChecked} checked, ${summary.linksUnverifiable} unverifiable); ` +
      `${summary.datesFixed} frozen dates fixed; took ${Date.now() - startedAt}ms`,
  );
}

main()
  .catch((error) => {
    console.error('[purge-expired] failed', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
