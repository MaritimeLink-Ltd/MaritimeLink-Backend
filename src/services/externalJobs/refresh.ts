import { fetchFeedJobs } from './feedSource.js';
import { dedupeJobs } from './dedupe.js';
import {
  fetchSerpApiJobs,
  getSerpApiQuota,
  isSerpApiConfigured,
} from './serpApiSource.js';
import { fetchJSearchJobs, isJSearchConfigured } from './jsearchSource.js';
import { isInMaritimeScope } from './scope.js';
import { rotationDayIndex, pickRotationSlice } from './rotation.js';
import { ExternalJob, ExternalJobQuery } from './types.js';
import { prisma } from '../../config/prisma.js';
import { env } from '../../config/env.js';

/**
 * Daily refresh: the only place that calls out to SerpApi, JSearch, or the
 * syndicated feeds. Run once a day by a scheduled job (see
 * scripts/refresh-external-jobs.ts), never by a user request —
 * `getExternalJobsForProfessional` only reads what this writes to
 * `external_job_listings`.
 *
 * SerpApi's Google Jobs engine has no "worldwide" mode: a query with no
 * `location` silently defaults to US results, so every query below carries an
 * explicit location. Both SerpApi (250/month) and JSearch (200/month, on
 * whatever plan is configured) are metered on tight free tiers, so this
 * cannot afford to run the full search-term × country grid every day —
 * instead each provider rotates its own daily slice through the grid (see
 * `buildSerpApiPlan` / `buildJSearchPlan`), and falls back to the free RSS
 * feed alone when a provider is unconfigured or exhausted rather than
 * erroring.
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
 * Countries to search, in priority order — the platform's actual target
 * markets rather than a broad sweep. UK first (rotation walks this list in
 * order, so earlier entries get queried on earlier days), then the other
 * priority sourcing/demand markets. Add/remove countries here to retune
 * coverage; SerpApi resolves these as free-text place names, JSearch maps
 * them to ISO codes via countryCodes.ts — keep both in step.
 */
const MARITIME_COUNTRIES = [
  'United Kingdom',
  'Nigeria',
  'Philippines',
  'India',
  'Germany',
  'Ethiopia',
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
 * Default daily ceiling if SERPAPI_MAX_QUERIES_PER_DAY isn't set. With the
 * 6-country grid (18 combinations), 8/day cycles the full grid in ~3 days
 * while staying at ~240/month — safely under the 250/month free-tier cap.
 */
const DEFAULT_SERPAPI_DAILY_BUDGET = 8;

/**
 * Default daily ceiling if JSEARCH_MAX_QUERIES_PER_DAY isn't set. Sized for a
 * 200-searches/month free tier: 6/day ≈ 180/month, leaving headroom (JSearch
 * has no free quota-check call to spend on, unlike SerpApi, so this budget is
 * the only thing keeping usage under the cap — see fetchJSearchJobs for the
 * mid-run stop-early fallback if the account is closer to empty than expected).
 */
const DEFAULT_JSEARCH_DAILY_BUDGET = 6;

/**
 * A listing survives this many days without being re-seen before it's
 * considered stale/likely expired. Sized to the 6-country grid: at the
 * default daily budgets above, the full 18-combination grid cycles in ~3
 * days for either provider, so ~2x that gives a safety buffer without
 * letting an expired listing (one no longer returned when its query comes
 * back around) linger for anywhere near as long as the old 20-country grid's
 * 14-day window required.
 */
const SERPAPI_STALE_AFTER_DAYS = 6;
const JSEARCH_STALE_AFTER_DAYS = 6;

const configuredDailyBudget = (
  envValue: string | undefined,
  fallback: number,
) => {
  const parsed = Number(envValue);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

/**
 * Picks today's SerpApi slice, clamped to whatever the account actually has
 * left this month (checked via SerpApi's free, unmetered account.json).
 */
const buildSerpApiPlan = async (
  dayIndex: number,
): Promise<{ queries: ExternalJobQuery[]; quotaNote: string }> => {
  if (!isSerpApiConfigured()) {
    return { queries: [], quotaNote: 'SERPAPI_KEY not set' };
  }

  const quota = await getSerpApiQuota();
  const configured = configuredDailyBudget(
    env.SERPAPI_MAX_QUERIES_PER_DAY,
    DEFAULT_SERPAPI_DAILY_BUDGET,
  );
  const budget = Math.min(configured, quota ? quota.searchesLeft : configured);

  const quotaNote = quota
    ? `${quota.searchesLeft}/${quota.monthlyLimit ?? '?'} searches left this month (${quota.planId ?? 'unknown plan'})`
    : 'quota check failed — using configured default only';

  if (budget <= 0) {
    return { queries: [], quotaNote: `${quotaNote} — skipping SerpApi today` };
  }

  return {
    queries: pickRotationSlice(QUERY_GRID, dayIndex, budget),
    quotaNote,
  };
};

/**
 * Picks today's JSearch slice. Unlike SerpApi, there's no free precheck —
 * the configured daily budget is the only pre-flight signal; actual
 * remaining quota only surfaces on real responses (see runJSearchQueries).
 */
const buildJSearchPlan = (
  dayIndex: number,
): { queries: ExternalJobQuery[]; note: string } => {
  if (!isJSearchConfigured()) {
    return { queries: [], note: 'JSEARCH_API_KEY not set' };
  }

  const budget = configuredDailyBudget(
    env.JSEARCH_MAX_QUERIES_PER_DAY,
    DEFAULT_JSEARCH_DAILY_BUDGET,
  );

  return {
    queries: pickRotationSlice(QUERY_GRID, dayIndex, budget),
    note: `budget ${budget}/day (no pre-flight quota check available)`,
  };
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

/**
 * Runs JSearch queries in sequence (not parallel, unlike SerpApi) so it can
 * watch `quotaRemaining` after each call and stop immediately once the
 * account is out, rather than firing a batch that's already known to fail.
 */
const runJSearchQueries = async (
  queries: ExternalJobQuery[],
): Promise<ExternalJob[]> => {
  const results: ExternalJob[] = [];

  for (const query of queries) {
    try {
      const { jobs, quotaRemaining } = await fetchJSearchJobs(query);
      results.push(...jobs);
      if (quotaRemaining !== null && quotaRemaining <= 0) {
        console.log(
          '[external-jobs] JSearch quota exhausted mid-run — stopping early',
        );
        break;
      }
    } catch (error) {
      console.error(
        `[external-jobs] JSearch query failed ("${query.q}"${query.location ? ` @ ${query.location}` : ''}):`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  return results;
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
  serpApiQueriesRun: number;
  serpApiQuotaNote: string;
  jSearchQueriesRun: number;
  jSearchNote: string;
  jobsFound: number;
  jobsStored: number;
  staleRemoved: number;
};

/**
 * Fetches every source, stores the result, and removes listings no longer
 * current. Safe to run repeatedly — it's a resync, not an append.
 *
 * Feed jobs are refetched in full every run (free, so no rotation needed) and
 * pruned if missing from this run. SerpApi/JSearch jobs only get touched by
 * that day's rotated slice, so they're pruned on a longer TTL instead — see
 * SERPAPI_STALE_AFTER_DAYS / JSEARCH_STALE_AFTER_DAYS.
 */
export const refreshExternalJobs = async (): Promise<RefreshSummary> => {
  const runStartedAt = new Date();
  const dayIndex = rotationDayIndex(runStartedAt);

  const [serpApiPlan, jSearchPlan] = await Promise.all([
    buildSerpApiPlan(dayIndex),
    Promise.resolve(buildJSearchPlan(dayIndex)),
  ]);

  console.log(`[external-jobs] SerpApi quota: ${serpApiPlan.quotaNote}`);
  console.log(`[external-jobs] JSearch: ${jSearchPlan.note}`);

  const [serpApiResults, jSearchResults, feedJobs] = await Promise.all([
    inChunks(serpApiPlan.queries, SERPAPI_CONCURRENCY, runSerpApiQuery),
    runJSearchQueries(jSearchPlan.queries),
    fetchFeedJobs().catch((error) => {
      console.error('[external-jobs] Feed fetch failed:', error);
      return [] as ExternalJob[];
    }),
  ]);

  const inScope = dedupeJobs(
    [...serpApiResults.flat(), ...jSearchResults, ...feedJobs].filter(
      isInMaritimeScope,
    ),
  );

  await inChunks(inScope, DB_WRITE_CONCURRENCY, (job) =>
    upsertListing(job, runStartedAt),
  );

  const serpApiStaleCutoff = new Date(
    runStartedAt.getTime() - SERPAPI_STALE_AFTER_DAYS * 24 * 60 * 60 * 1000,
  );
  const jSearchStaleCutoff = new Date(
    runStartedAt.getTime() - JSEARCH_STALE_AFTER_DAYS * 24 * 60 * 60 * 1000,
  );

  const [
    { count: staleFeedRemoved },
    { count: staleSerpApiRemoved },
    { count: staleJSearchRemoved },
  ] = await Promise.all([
    prisma.externalJobListing.deleteMany({
      where: { provider: 'feed', fetchedAt: { lt: runStartedAt } },
    }),
    prisma.externalJobListing.deleteMany({
      where: { provider: 'serpapi', fetchedAt: { lt: serpApiStaleCutoff } },
    }),
    prisma.externalJobListing.deleteMany({
      where: { provider: 'jsearch', fetchedAt: { lt: jSearchStaleCutoff } },
    }),
  ]);

  const summary: RefreshSummary = {
    serpApiQueriesRun: serpApiPlan.queries.length,
    serpApiQuotaNote: serpApiPlan.quotaNote,
    jSearchQueriesRun: jSearchPlan.queries.length,
    jSearchNote: jSearchPlan.note,
    jobsFound: inScope.length,
    jobsStored: inScope.length,
    staleRemoved: staleFeedRemoved + staleSerpApiRemoved + staleJSearchRemoved,
  };

  console.log('[external-jobs] refresh complete:', summary);
  return summary;
};
