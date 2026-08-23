import { fetchFeedJobs } from './feedSource.js';
import { dedupeJobs } from './dedupe.js';
import {
  fetchSerpApiJobs,
  getSerpApiQuota,
  isSerpApiConfigured,
} from './serpApiSource.js';
import { isInMaritimeScope } from './scope.js';
import { ExternalJob, ExternalJobQuery } from './types.js';
import { prisma } from '../../config/prisma.js';
import { env } from '../../config/env.js';

/**
 * Daily refresh: the only place that calls out to SerpApi or the syndicated
 * feeds. Run once a day by a scheduled job (see scripts/refresh-external-jobs.ts),
 * never by a user request — `getExternalJobsForProfessional` only reads what
 * this writes to `external_job_listings`.
 *
 * SerpApi's Google Jobs engine has no "worldwide" mode: a query with no
 * `location` silently defaults to US results, so every query below carries an
 * explicit location. SerpApi's free tier is only 250 searches total per
 * *month*, not per day, so this cannot afford to run the full search-term ×
 * country grid every day — instead it rotates a small daily slice through the
 * grid (see `buildQueryPlan`), checks the account's actual remaining quota
 * before spending any of it, and falls back to the free RSS feed alone when
 * the quota is exhausted rather than erroring.
 */

/**
 * Broad, maritime-scoped search terms. Kept general on purpose — specificity
 * comes from crossing these with MARITIME_COUNTRIES below, not from more terms.
 */
const SEARCH_TERMS = [
  'maritime seafarer jobs',
  'deck officer marine engineer jobs',
  'seafarer ratings crew catering jobs',
];

/**
 * Countries to search, in rough order of maritime labour market size. The US
 * and Canada are included but kept to two entries out of ~20 deliberately —
 * without an explicit location every query defaulted there. Add/remove
 * countries here to retune coverage; SerpApi resolves these as free-text
 * place names, not ISO codes.
 */
const MARITIME_COUNTRIES = [
  // Priority: UK first, then broad reach — the rotation below walks this
  // list in order, so earlier entries get queried on earlier days.
  'United Kingdom',
  'Philippines',
  'India',
  'China',
  'Indonesia',
  'Ukraine',
  'Russia',
  'Poland',
  'Croatia',
  'Greece',
  'Turkey',
  'Nigeria',
  'Ghana',
  'Bangladesh',
  'Vietnam',
  'Romania',
  'United Arab Emirates',
  'Singapore',
  'United States',
  'Canada',
];

/**
 * Every (term, country) combination — the full grid, not what runs in one
 * day. Term-major order (all countries under the first, most general term
 * before moving to narrower terms) means the rotation covers broad
 * geographic reach first and fills in category-specific searches later.
 */
const QUERY_GRID: ExternalJobQuery[] = SEARCH_TERMS.flatMap((q) =>
  MARITIME_COUNTRIES.map((location) => ({ q, location })),
);

/**
 * Default daily ceiling if SERPAPI_MAX_QUERIES_PER_DAY isn't set. Sized for a
 * 250-searches/*month* free-tier account (8/day ≈ 240/month, leaving headroom
 * for occasional manual testing). Raise via the env var on a bigger plan —
 * the rotation below automatically cycles the full grid faster as the budget
 * grows, no code change needed.
 */
const DEFAULT_DAILY_BUDGET = 8;

/**
 * A listing survives this many days without being re-seen before it's
 * considered stale. Must be generous relative to how long the daily budget
 * takes to cycle the full QUERY_GRID once (at 8/day across 60 combinations,
 * that's ~7.5 days) — otherwise rotation would delete a country's jobs the
 * moment today's slice moves on to different countries.
 */
const SERPAPI_STALE_AFTER_DAYS = 14;

/** Rotation day 0 — do not change casually, it re-shuffles which slice runs on which day. */
const ROTATION_START = new Date('2026-08-22T00:00:00Z');

const configuredDailyBudget = () => {
  const parsed = Number(env.SERPAPI_MAX_QUERIES_PER_DAY);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_DAILY_BUDGET;
};

/**
 * Picks today's slice of the query grid, deterministically rotating so a
 * different slice runs each day with no state to persist — just today's date.
 * Never spends more than the account actually has left this month.
 */
const buildQueryPlan = async (): Promise<{
  queries: ExternalJobQuery[];
  quotaNote: string;
}> => {
  if (!isSerpApiConfigured()) {
    return { queries: [], quotaNote: 'SERPAPI_KEY not set' };
  }

  const quota = await getSerpApiQuota();
  const budget = Math.min(
    configuredDailyBudget(),
    quota ? quota.searchesLeft : configuredDailyBudget(),
  );

  const quotaNote = quota
    ? `${quota.searchesLeft}/${quota.monthlyLimit ?? '?'} searches left this month (${quota.planId ?? 'unknown plan'})`
    : 'quota check failed — using configured default only';

  if (budget <= 0) {
    return { queries: [], quotaNote: `${quotaNote} — skipping SerpApi today` };
  }

  // Anchored to a fixed date (not the Unix epoch) so day 0 of the rotation
  // lands on the front of QUERY_GRID — i.e. the priority countries actually
  // get queried first, rather than wherever an epoch-relative offset happens
  // to fall on a given day.
  const dayIndex = Math.max(
    0,
    Math.floor((Date.now() - ROTATION_START.getTime()) / (24 * 60 * 60 * 1000)),
  );
  const offset = (dayIndex * budget) % QUERY_GRID.length;
  const queries = Array.from(
    { length: Math.min(budget, QUERY_GRID.length) },
    (_, i) => QUERY_GRID[(offset + i) % QUERY_GRID.length],
  );

  return { queries, quotaNote };
};

const runSerpApiQuery = async (
  query: ExternalJobQuery,
): Promise<ExternalJob[]> => {
  try {
    return await fetchSerpApiJobs(query);
  } catch (error) {
    // No retry: the quota is too scarce to spend twice on one query. A
    // failed search just waits for its next turn in the rotation.
    console.error(
      `[external-jobs] SerpApi query failed ("${query.q}"${query.location ? ` @ ${query.location}` : ''}):`,
      error instanceof Error ? error.message : error,
    );
    return [];
  }
};

/** Conservative — SerpApi calls compete for outbound bandwidth/rate limit; a wide burst risks timeouts. */
const SERPAPI_CONCURRENCY = 4;

/** DB writes are cheap and local to the pool; can run wider than the SerpApi fan-out. */
const DB_WRITE_CONCURRENCY = 10;

/** Splits work into chunks so we don't open more concurrent connections than upstream can handle. */
const inChunks = async <T, R>(
  items: T[],
  size: number,
  run: (item: T) => Promise<R>,
) => {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    const chunk = items.slice(i, i + size);
    results.push(...(await Promise.all(chunk.map(run))));
  }
  return results;
};

const upsertListing = (job: ExternalJob, fetchedAt: Date) =>
  prisma.externalJobListing.upsert({
    where: { id: job.id },
    create: {
      id: job.id,
      title: job.title,
      company: job.company,
      location: job.location,
      description: job.description,
      salary: job.salary,
      postedAt: job.postedAt,
      applyLink: job.applyLink,
      via: job.via,
      thumbnail: job.thumbnail,
      category: job.category,
      employmentType: job.employmentType,
      provider: job.provider,
      fetchedAt,
    },
    update: {
      title: job.title,
      company: job.company,
      location: job.location,
      description: job.description,
      salary: job.salary,
      postedAt: job.postedAt,
      applyLink: job.applyLink,
      via: job.via,
      thumbnail: job.thumbnail,
      category: job.category,
      employmentType: job.employmentType,
      provider: job.provider,
      fetchedAt,
    },
  });

export type RefreshSummary = {
  queriesRun: number;
  quotaNote: string;
  jobsFound: number;
  jobsStored: number;
  staleRemoved: number;
};

/**
 * Fetches every source, stores the result, and removes listings no longer
 * current. Safe to run repeatedly — it's a resync, not an append.
 *
 * Feed jobs are refetched in full every run (free, so no rotation needed) and
 * pruned if missing from this run. SerpApi jobs only get touched by today's
 * rotated slice, so they're pruned on a longer TTL instead — see
 * SERPAPI_STALE_AFTER_DAYS.
 */
export const refreshExternalJobs = async (): Promise<RefreshSummary> => {
  const runStartedAt = new Date();

  const { queries, quotaNote } = await buildQueryPlan();
  console.log(`[external-jobs] SerpApi quota: ${quotaNote}`);

  const [serpApiResults, feedJobs] = await Promise.all([
    inChunks(queries, SERPAPI_CONCURRENCY, runSerpApiQuery),
    fetchFeedJobs().catch((error) => {
      console.error('[external-jobs] Feed fetch failed:', error);
      return [] as ExternalJob[];
    }),
  ]);

  const inScope = dedupeJobs(
    [...serpApiResults.flat(), ...feedJobs].filter(isInMaritimeScope),
  );

  await inChunks(inScope, DB_WRITE_CONCURRENCY, (job) =>
    upsertListing(job, runStartedAt),
  );

  const serpApiStaleCutoff = new Date(
    runStartedAt.getTime() - SERPAPI_STALE_AFTER_DAYS * 24 * 60 * 60 * 1000,
  );

  const [{ count: staleFeedRemoved }, { count: staleSerpApiRemoved }] =
    await Promise.all([
      prisma.externalJobListing.deleteMany({
        where: { provider: 'feed', fetchedAt: { lt: runStartedAt } },
      }),
      prisma.externalJobListing.deleteMany({
        where: { provider: 'serpapi', fetchedAt: { lt: serpApiStaleCutoff } },
      }),
    ]);

  const summary: RefreshSummary = {
    queriesRun: queries.length,
    quotaNote,
    jobsFound: inScope.length,
    jobsStored: inScope.length,
    staleRemoved: staleFeedRemoved + staleSerpApiRemoved,
  };

  console.log('[external-jobs] refresh complete:', summary);
  return summary;
};
