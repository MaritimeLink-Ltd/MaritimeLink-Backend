import { prisma } from '../../config/prisma.js';
import { isExpiryProneLink, isUncheckableLink } from './applyLink.js';
import { checkLink } from './linkLiveness.js';
import { findDatePosted } from './postedDate.js';
import { rotationDayIndex } from './rotation.js';
import { relativeToIso } from './textUtils.js';
import { ExternalJob } from './types.js';

/**
 * Keeps every external job in the Jobs section under 30 days old, and
 * permanently deletes expired ones.
 *
 * The age limit applies to every source — search results and company
 * boards alike — measured from the job's real posted date (or, when no
 * date can be found, the day we first saw it):
 *   - Fetched jobs over the limit are never saved (`verifyFetchedJobs`).
 *     A company-board job with no date in its feed gets one from its job
 *     page first (postedDate.ts).
 *   - Saved jobs that cross the limit are deleted (`purgeExpiredListings`),
 *     and remembered in `expired_external_jobs` so tomorrow's refresh can't
 *     re-create them as if new. The Jobs section also hides anything over
 *     the limit between runs (index.ts).
 *
 * Search listings (SerpApi/JSearch) have more ways to go stale, since they
 * aren't re-read in full daily the way company boards are (a closed board
 * posting disappears from its source and is pruned by refresh.ts):
 *   1. Links on an expiry-prone re-posting site (applyLink.ts) are removed.
 *   2. Links are checked where the site allows it (linkLiveness.ts) and
 *      deleted on a 404/410 or a "no longer available" page — before saving,
 *      and every LINK_CHECK_EVERY_DAYS after.
 *   3. A listing with no posted date AND a link that can't be checked has
 *      no evidence at all that it's still open, so it isn't kept.
 */

/**
 * The client's rule: nothing in the Jobs section older than a month.
 * Also the standard job-ad lifetime on the major boards; JSearch is already
 * asked for jobs posted within the last month.
 */
export const MAX_LISTING_AGE_DAYS = 30;

/**
 * How long an expired job's id is remembered. Long enough to outlast any
 * source still listing it; after that, if it's somehow still listed, it
 * can come back for at most another MAX_LISTING_AGE_DAYS.
 */
export const EXPIRED_ID_RETENTION_DAYS = 180;

/** Undated company-board jobs looked up on their job page per run (first run of a new board only). */
const MAX_DATE_LOOKUPS_PER_RUN = 500;

/** Each existing listing's link is re-checked every this many days. */
export const LINK_CHECK_EVERY_DAYS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;
const LINK_CHECK_CONCURRENCY = 24;
const SEARCH_PROVIDERS = new Set(['serpapi', 'jsearch']);
const isSearchProvider = (provider: string) => SEARCH_PROVIDERS.has(provider);

/** Stable 0..n-1 bucket per listing, so each day checks a different third. */
const bucketOf = (id: string, buckets: number) => {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1)
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return hash % buckets;
};

type ListingRow = {
  id: string;
  provider: string;
  applyLink: string | null;
  postedAt: string | null;
  createdAt: Date;
  fetchedAt: Date;
  hiddenByAdmin: boolean;
};

/** Real posted date where known, otherwise first-seen. */
export const effectivePostedMs = (
  row: Pick<ListingRow, 'postedAt' | 'createdAt'>,
): number => {
  const posted = row.postedAt ? Date.parse(row.postedAt) : NaN;
  return Number.isNaN(posted) ? row.createdAt.getTime() : posted;
};

export const isPastMaxAge = (
  row: Pick<ListingRow, 'postedAt' | 'createdAt'>,
  now: Date,
): boolean =>
  now.getTime() - effectivePostedMs(row) > MAX_LISTING_AGE_DAYS * DAY_MS;

/** Remembers expired ids so a later refresh can't re-create them. */
const rememberExpired = async (ids: string[]) => {
  if (ids.length === 0) return;
  await prisma.expiredExternalJob.createMany({
    data: ids.map((id) => ({ id })),
    skipDuplicates: true,
  });
};

/** No posted date and a link the checker can't read: nothing says it's still open. */
export const isUnverifiableAndUndated = (
  row: Pick<ListingRow, 'postedAt' | 'applyLink'>,
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

export const purgeExpiredListings = async ({
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
  const rows: ListingRow[] = await prisma.externalJobListing.findMany({
    select: {
      id: true,
      provider: true,
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
      isSearchProvider(row.provider) &&
      !row.hiddenByAdmin &&
      row.applyLink &&
      isExpiryProneLink(row.applyLink),
  );
  // Every source, hidden rows included.
  const tooOld = rows.filter(
    (row) => !expiryProne.includes(row) && isPastMaxAge(row, now),
  );
  const unverifiable = rows.filter(
    (row) =>
      isSearchProvider(row.provider) &&
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
      isSearchProvider(row.provider) &&
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
  await rememberExpired(tooOld.map((row) => row.id));
  if (deleteIds.length > 0) {
    await prisma.externalJobListing.deleteMany({
      where: { id: { in: deleteIds } },
    });
  }
  await prisma.expiredExternalJob.deleteMany({
    where: {
      expiredAt: {
        lt: new Date(now.getTime() - EXPIRED_ID_RETENTION_DAYS * DAY_MS),
      },
    },
  });

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

export type FetchedJobsVerdict = {
  /** Jobs to save — company-board jobs with any posted date found filled in. */
  kept: ExternalJob[];
  /** Jobs that failed — also deleted from the database if already stored. */
  rejectedIds: string[];
  counts: {
    previouslyExpired: number;
    expiryProne: number;
    tooOld: number;
    unverifiable: number;
    deadLink: number;
    datesFound: number;
  };
};

/**
 * Applies the expiry rules to a run's fetched jobs BEFORE they're saved:
 * the age limit to every source, the link rules to search results.
 */
export const verifyFetchedJobs = async (
  jobs: ExternalJob[],
  now: Date = new Date(),
): Promise<FetchedJobsVerdict> => {
  const counts = {
    previouslyExpired: 0,
    expiryProne: 0,
    tooOld: 0,
    unverifiable: 0,
    deadLink: 0,
    datesFound: 0,
  };
  const rejectedIds: string[] = [];
  const kept: ExternalJob[] = [];
  const ids = jobs.map((job) => job.id);

  // Already deleted for age: don't re-create it, or re-read its page.
  const expiredIds = new Set(
    (
      await prisma.expiredExternalJob.findMany({
        where: { id: { in: ids } },
        select: { id: true },
      })
    ).map((row) => row.id),
  );
  // A job seen before keeps its first-seen date (and any posted date
  // already found for it).
  const stored = new Map(
    (
      await prisma.externalJobListing.findMany({
        where: { id: { in: ids } },
        select: { id: true, createdAt: true, postedAt: true },
      })
    ).map((row) => [row.id, row]),
  );

  const candidates: ExternalJob[] = [];
  for (const job of jobs) {
    if (expiredIds.has(job.id)) {
      counts.previouslyExpired += 1;
      rejectedIds.push(job.id);
    } else {
      candidates.push(job);
    }
  }

  // Company-board jobs whose feed has no date: reuse the one found before,
  // or read it off the job page.
  const lookups: ExternalJob[] = [];
  const dated = candidates.map((job) => {
    if (isSearchProvider(job.provider) || job.postedAt) return job;
    const known = stored.get(job.id)?.postedAt;
    if (known) return { ...job, postedAt: known };
    if (job.applyLink && lookups.length < MAX_DATE_LOOKUPS_PER_RUN) {
      lookups.push(job);
    }
    return job;
  });
  const foundDates = new Map<string, string>();
  for (let i = 0; i < lookups.length; i += LINK_CHECK_CONCURRENCY) {
    const chunk = lookups.slice(i, i + LINK_CHECK_CONCURRENCY);
    const dates = await Promise.all(
      chunk.map((job) => findDatePosted(job.applyLink as string)),
    );
    dates.forEach((date, j) => {
      if (date) foundDates.set(chunk[j].id, date);
    });
  }
  counts.datesFound = foundDates.size;

  const tooOld: string[] = [];
  const toCheck: ExternalJob[] = [];
  for (const candidate of dated) {
    const job = foundDates.has(candidate.id)
      ? { ...candidate, postedAt: foundDates.get(candidate.id) as string }
      : candidate;
    const row = {
      postedAt: job.postedAt,
      createdAt: stored.get(job.id)?.createdAt ?? now,
      applyLink: job.applyLink,
    };

    if (isPastMaxAge(row, now)) {
      counts.tooOld += 1;
      tooOld.push(job.id);
      rejectedIds.push(job.id);
    } else if (!isSearchProvider(job.provider)) {
      kept.push(job);
    } else if (!job.applyLink || isExpiryProneLink(job.applyLink)) {
      counts.expiryProne += 1;
      rejectedIds.push(job.id);
    } else if (isUnverifiableAndUndated(row)) {
      counts.unverifiable += 1;
      rejectedIds.push(job.id);
    } else {
      toCheck.push(job);
    }
  }
  await rememberExpired(tooOld);

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

  console.log('[external-jobs] fetched jobs rejected before saving:', counts);
  return { kept, rejectedIds, counts };
};
