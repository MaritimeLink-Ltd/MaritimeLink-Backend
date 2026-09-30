import { prisma } from '../../config/prisma.js';
import { isExpiryProneLink, isUncheckableLink } from './applyLink.js';
import { checkLink } from './linkLiveness.js';
import { rotationDayIndex } from './rotation.js';
import { relativeToIso } from './textUtils.js';
import { ExternalJob } from './types.js';

/**
 * Permanently deletes expired search listings (SerpApi/JSearch). Company
 * boards aren't touched here: they're re-read in full every day, so a
 * closed posting disappears from its source and is pruned by refresh.ts.
 *
 * Search listings have no such signal — a vacancy isn't "gone" just
 * because today's rotation didn't search for it — so three layers stand in:
 *   1. Links on an expiry-prone re-posting site (applyLink.ts) are removed.
 *      New results already skip those; this clears rows saved before.
 *   2. Links are checked where the site allows it (linkLiveness.ts) and
 *      deleted on a 404/410 or a "no longer available" page.
 *   3. Everything else ages out SEARCH_LISTING_MAX_AGE_DAYS after its real
 *      posted date (or first-seen date when the source gave none) — the
 *      backstop for LinkedIn/Indeed/Glassdoor links, which can't be checked.
 *   4. A listing with no posted date AND a link that can't be checked has
 *      no evidence at all that it's still open, so it isn't kept.
 *
 * Every search result fetched in a run goes through the same rules BEFORE
 * it's saved (`verifyFetchedSearchJobs`), so a dead link is never stored —
 * including a vacancy we already had, which Google keeps returning after
 * the employer closed it. `purgeExpiredSearchListings` then re-checks the
 * rest of the pool on a rotation.
 */

/**
 * Standard job-ad lifetime on the major boards; JSearch is already asked
 * for jobs posted within the last month. Well above the ~21-day search
 * rotation (queryGrid.ts), so a still-open vacancy is normally re-found
 * before it ages out.
 */
export const SEARCH_LISTING_MAX_AGE_DAYS = 30;

/** Each existing listing's link is re-checked every this many days. */
export const LINK_CHECK_EVERY_DAYS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;
const LINK_CHECK_CONCURRENCY = 24;

/** Stable 0..n-1 bucket per listing, so each day checks a different third. */
const bucketOf = (id: string, buckets: number) => {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1)
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return hash % buckets;
};

type SearchRow = {
  id: string;
  applyLink: string | null;
  postedAt: string | null;
  createdAt: Date;
  fetchedAt: Date;
  hiddenByAdmin: boolean;
};

/** Real posted date where known, otherwise first-seen. */
export const effectivePostedMs = (
  row: Pick<SearchRow, 'postedAt' | 'createdAt'>,
): number => {
  const posted = row.postedAt ? Date.parse(row.postedAt) : NaN;
  return Number.isNaN(posted) ? row.createdAt.getTime() : posted;
};

export const isPastMaxAge = (
  row: Pick<SearchRow, 'postedAt' | 'createdAt'>,
  now: Date,
): boolean =>
  now.getTime() - effectivePostedMs(row) > SEARCH_LISTING_MAX_AGE_DAYS * DAY_MS;

/** No posted date and a link the checker can't read: nothing says it's still open. */
export const isUnverifiableAndUndated = (
  row: Pick<SearchRow, 'postedAt' | 'applyLink'>,
): boolean =>
  Boolean(row.applyLink && isUncheckableLink(row.applyLink)) &&
  (!row.postedAt || Number.isNaN(Date.parse(row.postedAt)));

/** Whether today's rotation re-checks this listing's link. */
export const isDueForLinkCheck = (id: string, dayIndex: number): boolean =>
  bucketOf(id, LINK_CHECK_EVERY_DAYS) === dayIndex % LINK_CHECK_EVERY_DAYS;

export type ExpiryPurgeSummary = {
  datesFixed: number;
  expiryProneRemoved: number;
  tooOldRemoved: number;
  unverifiableRemoved: number;
  linksChecked: number;
  linksUnverifiable: number;
  deadLinksRemoved: number;
  total: number;
};

export const purgeExpiredSearchListings = async ({
  now = new Date(),
  verifiedSince,
  checkAllLinks = false,
}: {
  now?: Date;
  /** Rows fetched at/after this were link-checked before saving; don't check twice. */
  verifiedSince?: Date;
  /** Check every link instead of today's third (one-off cleanups). */
  checkAllLinks?: boolean;
} = {}): Promise<ExpiryPurgeSummary> => {
  const rows: SearchRow[] = await prisma.externalJobListing.findMany({
    where: { provider: { in: ['serpapi', 'jsearch'] } },
    select: {
      id: true,
      applyLink: true,
      postedAt: true,
      createdAt: true,
      fetchedAt: true,
      hiddenByAdmin: true,
    },
  });

  // Rows saved before posted dates were stored as real dates still carry
  // frozen relative text ("3 days ago"); it was relative to when the row
  // was last fetched, so anchor it there.
  let datesFixed = 0;
  for (const row of rows) {
    if (!row.postedAt || !Number.isNaN(Date.parse(row.postedAt))) continue;
    const fixed = relativeToIso(row.postedAt, row.fetchedAt);
    if (!fixed) continue;
    await prisma.externalJobListing.update({
      where: { id: row.id },
      data: { postedAt: fixed },
    });
    row.postedAt = fixed;
    datesFixed += 1;
  }

  // Admin-hidden rows stay as tombstones (they stop a removed scam listing
  // from being re-created) until they age out.
  const expiryProne = rows.filter(
    (row) =>
      !row.hiddenByAdmin && row.applyLink && isExpiryProneLink(row.applyLink),
  );
  const tooOld = rows.filter(
    (row) => !expiryProne.includes(row) && isPastMaxAge(row, now),
  );
  const unverifiable = rows.filter(
    (row) =>
      !row.hiddenByAdmin &&
      !expiryProne.includes(row) &&
      !tooOld.includes(row) &&
      isUnverifiableAndUndated(row),
  );

  const removed = new Set(
    [...expiryProne, ...tooOld, ...unverifiable].map((row) => row.id),
  );
  const dayIndex = rotationDayIndex(now);
  const toCheck = rows.filter(
    (row) =>
      !removed.has(row.id) &&
      !row.hiddenByAdmin &&
      row.applyLink &&
      !(verifiedSince && row.fetchedAt >= verifiedSince) &&
      (checkAllLinks || isDueForLinkCheck(row.id, dayIndex)),
  );

  const unreachableHosts = new Set<string>();
  const dead: string[] = [];
  let linksUnverifiable = 0;
  for (let i = 0; i < toCheck.length; i += LINK_CHECK_CONCURRENCY) {
    const chunk = toCheck.slice(i, i + LINK_CHECK_CONCURRENCY);
    const statuses = await Promise.all(
      chunk.map((row) => checkLink(row.applyLink as string, unreachableHosts)),
    );
    statuses.forEach((status, j) => {
      if (status === 'expired') dead.push(chunk[j].id);
      if (status === 'unknown') linksUnverifiable += 1;
    });
  }

  const deleteIds = [...removed, ...dead];
  if (deleteIds.length > 0) {
    await prisma.externalJobListing.deleteMany({
      where: { id: { in: deleteIds } },
    });
  }

  const summary: ExpiryPurgeSummary = {
    datesFixed,
    expiryProneRemoved: expiryProne.length,
    tooOldRemoved: tooOld.length,
    unverifiableRemoved: unverifiable.length,
    linksChecked: toCheck.length,
    linksUnverifiable,
    deadLinksRemoved: dead.length,
    total: deleteIds.length,
  };
  console.log('[external-jobs] expired-listing purge:', summary);
  return summary;
};

const SEARCH_PROVIDERS = new Set(['serpapi', 'jsearch']);

export type FetchedJobsVerdict = {
  /** Everything to save: company-board jobs untouched, search jobs that passed. */
  kept: ExternalJob[];
  /** Search jobs that failed — also deleted from the database if already stored. */
  rejectedIds: string[];
  counts: {
    expiryProne: number;
    tooOld: number;
    unverifiable: number;
    deadLink: number;
  };
};

/**
 * Applies the expiry rules to a run's fetched search results BEFORE they're
 * saved. Company-board jobs pass through: their sources are re-read in full
 * daily and pruned when a posting closes.
 */
export const verifyFetchedSearchJobs = async (
  jobs: ExternalJob[],
  now: Date = new Date(),
): Promise<FetchedJobsVerdict> => {
  const counts = { expiryProne: 0, tooOld: 0, unverifiable: 0, deadLink: 0 };
  const rejectedIds: string[] = [];
  const toCheck: ExternalJob[] = [];
  const kept: ExternalJob[] = [];

  // First seen now — a fetched job's age is its real posted date or today.
  for (const job of jobs) {
    if (!SEARCH_PROVIDERS.has(job.provider)) {
      kept.push(job);
      continue;
    }
    const row = {
      postedAt: job.postedAt,
      createdAt: now,
      applyLink: job.applyLink,
    };
    if (!job.applyLink || isExpiryProneLink(job.applyLink))
      counts.expiryProne += 1;
    else if (isPastMaxAge(row, now)) counts.tooOld += 1;
    else if (isUnverifiableAndUndated(row)) counts.unverifiable += 1;
    else {
      toCheck.push(job);
      continue;
    }
    rejectedIds.push(job.id);
  }

  const unreachableHosts = new Set<string>();
  for (let i = 0; i < toCheck.length; i += LINK_CHECK_CONCURRENCY) {
    const chunk = toCheck.slice(i, i + LINK_CHECK_CONCURRENCY);
    const statuses = await Promise.all(
      chunk.map((job) => checkLink(job.applyLink as string, unreachableHosts)),
    );
    statuses.forEach((status, j) => {
      if (status === 'expired') {
        counts.deadLink += 1;
        rejectedIds.push(chunk[j].id);
      } else {
        kept.push(chunk[j]);
      }
    });
  }

  console.log(
    '[external-jobs] fetched search jobs rejected before saving:',
    counts,
  );
  return { kept, rejectedIds, counts };
};
