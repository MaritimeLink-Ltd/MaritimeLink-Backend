import axios from 'axios';
import { fetchFeedJobs } from './feedSource.js';
import { fetchAtsJobs } from './ats/index.js';
import { FULL_REFRESH_PROVIDERS, prunablePrefixes } from './prune.js';
import {
  purgeExpiredSearchListings,
  verifyFetchedSearchJobs,
} from './expiry.js';
import { dedupeJobs } from './dedupe.js';
import {
  fetchSerpApiJobs,
  getSerpApiQuota,
  isSerpApiConfigured,
  isSerpApiQuotaError,
  resolveSerpApiKeys,
  SERPAPI_PAGE_SIZE,
} from './serpApiSource.js';
import {
  fetchJSearchJobs,
  isJSearchConfigured,
  isJSearchQuotaError,
  JSEARCH_PAGE_SIZE,
  resolveJSearchKeys,
} from './jsearchSource.js';
import { inScopeRatio, isInMaritimeScope, isWorthABonusPage } from './scope.js';
import { rotationDayIndex, pickRotationSlice } from './rotation.js';
import {
  countriesFor,
  dailyFloorQueries,
  MARITIME_COUNTRIES,
  QUERY_GRID,
  secondaryGridFor,
} from './queryGrid.js';
import { ApiKeyPool, maskApiKey } from './apiKeyPool.js';
import { ExternalJob, ExternalJobQuery } from './types.js';
import { prisma } from '../../config/prisma.js';
import { env } from '../../config/env.js';

/**
 * Daily refresh: the only place that calls out to SerpApi, JSearch, the
 * syndicated feeds, or the ATS company sources (Greenhouse/Lever/
 * SmartRecruiters/Workday, see ./ats/). Run once a day by a scheduled job (see
 * scripts/refresh-external-jobs.ts), never by a user request —
 * `getExternalJobsForProfessional` only reads what this writes to
 * `external_job_listings`.
 *
 * SerpApi's Google Jobs engine has no "worldwide" mode: a query with no
 * `location` silently defaults to US results, so every query below carries an
 * explicit location. Both providers are metered on free tiers (SerpApi
 * 250/month per key, JSearch 200/month per key), so this cannot run the full
 * query space daily — each provider's day is split into a guaranteed floor
 * (one search per country, every day — see `dailyFloorQueries`) plus whatever
 * budget is left over, which rotates through the rank, specialist and
 * city-level searches in `secondaryGridFor` (queryGrid.ts), sized to however
 * many keys are configured (apiKeyPool.ts). RSS feeds (fetchFeedJobs) are a
 * third, unmetered source, but no default feeds are configured — see
 * feedSource.ts for why.
 */

/**
 * Per-key daily ceilings, each sized so a full month stays inside one free
 * key's quota (31 days x 8 = 248 of SerpApi's 250; 31 x 6 = 186 of JSearch's
 * 200). The day's budget is this times the number of configured keys, so
 * adding a key widens coverage without touching any of these numbers.
 */
const SERPAPI_SEARCHES_PER_KEY_PER_DAY = 8;
const JSEARCH_SEARCHES_PER_KEY_PER_DAY = 6;

/**
 * An optional hard cap on the day's searches, across all of a provider's keys.
 * Unset is the normal case — the pool's own allowance is already the right
 * number. Only lowers, never raises: a cap above what the keys can spend would
 * be a promise the quota can't keep.
 */
const applyConfiguredCap = (
  poolAllowance: number,
  configured: string | undefined,
): number => {
  const cap = Number(configured);
  return Number.isFinite(cap) && cap > 0
    ? Math.min(cap, poolAllowance)
    : poolAllowance;
};

/**
 * True when a failed request still cost a search. A response — even an error
 * one — means the provider processed it; no response at all (timeout, DNS,
 * socket) means it never counted, so the claim can go back to the pool.
 */
const wasCharged = (error: unknown): boolean =>
  !axios.isAxiosError(error) || Boolean(error.response);

const describeQuery = (query: ExternalJobQuery) =>
  `"${query.q}"${query.location ? ` @ ${query.location}` : ''}`;

/**
 * One line per search, so a keyword that keeps returning nothing — or
 * nothing that survives the scope filter — shows up in the run log instead
 * of silently eating a unit of quota every time its turn comes around.
 */
const logQueryYield = (
  provider: string,
  query: ExternalJobQuery,
  jobs: ExternalJob[],
  note?: string,
) =>
  console.log(
    `[external-jobs] ${provider} ${describeQuery(query)} -> ${jobs.length} returned, ${jobs.filter(isInMaritimeScope).length} in scope${note ? ` (${note})` : ''}`,
  );

/**
 * Builds the SerpApi pool from a live per-key quota check — free and
 * unmetered on SerpApi's side, so it costs nothing to ask each key what it
 * actually has left rather than trusting the configured ceiling.
 */
const buildSerpApiPool = async (): Promise<{
  pool: ApiKeyPool;
  note: string;
}> => {
  const keys = resolveSerpApiKeys();
  if (keys.length === 0) {
    return { pool: new ApiKeyPool([]), note: 'no SERPAPI_KEY configured' };
  }

  const quotas = await Promise.all(keys.map((key) => getSerpApiQuota(key)));

  const allowances = keys.map((key, index) => {
    const quota = quotas[index];
    return {
      key,
      allowance: quota
        ? Math.min(SERPAPI_SEARCHES_PER_KEY_PER_DAY, quota.searchesLeft)
        : // A failed check is not evidence the key is empty — fall back to the
          // configured ceiling rather than skipping an otherwise good key.
          SERPAPI_SEARCHES_PER_KEY_PER_DAY,
    };
  });

  const perKeyNotes = keys.map((key, index) => {
    const quota = quotas[index];
    return quota
      ? `${maskApiKey(key)}: ${quota.searchesLeft}/${quota.monthlyLimit ?? '?'} left`
      : `${maskApiKey(key)}: quota check failed, assuming default`;
  });

  return {
    pool: new ApiKeyPool(allowances),
    note: `${keys.length} key(s) — ${perKeyNotes.join('; ')}`,
  };
};

/**
 * Builds the JSearch pool. No pre-flight check exists, so every key starts at
 * its configured ceiling and is corrected downward mid-run from the
 * `x-ratelimit-requests-remaining` header on real responses.
 */
const buildJSearchPool = (): { pool: ApiKeyPool; note: string } => {
  const keys = resolveJSearchKeys();
  if (keys.length === 0) {
    return { pool: new ApiKeyPool([]), note: 'no JSEARCH_API_KEY configured' };
  }

  const pool = new ApiKeyPool(
    keys.map((key) => ({ key, allowance: JSEARCH_SEARCHES_PER_KEY_PER_DAY })),
  );

  return {
    pool,
    note: `${keys.length} key(s) x ${JSEARCH_SEARCHES_PER_KEY_PER_DAY}/day (no pre-flight quota check available)`,
  };
};

type SerpApiPage = { jobs: ExternalJob[]; nextPageToken: string | null };

/**
 * Fetches one SerpApi page, moving to another key if the one it drew turns
 * out to be spent. A page is only abandoned once every key has been tried —
 * a search lost to an exhausted key would otherwise wait a full rotation for
 * its next turn. `page` is null when nothing was fetched (no key left in the
 * pool, or a failure) — distinct from a search that ran and found nothing.
 */
const fetchSerpApiPage = async (
  query: ExternalJobQuery,
  pool: ApiKeyPool,
  pageToken?: string,
): Promise<{ page: SerpApiPage | null; spent: number }> => {
  let spent = 0;
  for (let attempt = 0; attempt < Math.max(1, pool.keyCount); attempt += 1) {
    const key = pool.take();
    if (!key) return { page: null, spent };

    try {
      const page = await fetchSerpApiJobs(query, key, pageToken);
      return { page, spent: spent + 1 };
    } catch (error) {
      if (isSerpApiQuotaError(error)) {
        console.warn(
          `[external-jobs] SerpApi key ${maskApiKey(key)} is out of quota — retiring it for this run`,
        );
        pool.markExhausted(key);
        spent += 1;
        continue;
      }

      if (wasCharged(error)) spent += 1;
      else pool.refund(key);

      // No retry on the same key: quota is too scarce to spend twice on one
      // page. A failed search just waits for its next turn in the rotation.
      console.error(
        `[external-jobs] SerpApi query failed (${describeQuery(query)}${pageToken ? ' [bonus page]' : ''}):`,
        error instanceof Error ? error.message : error,
      );
      return { page: null, spent };
    }
  }
  return { page: null, spent };
};

/** Conservative — SerpApi calls compete for outbound bandwidth/rate limit; a wide burst risks timeouts. */
const SERPAPI_CONCURRENCY = 4;

/**
 * Runs the day's SerpApi plan in two phases:
 *
 *   1. The first page of every planned search (floor, then secondary).
 *   2. With whatever budget is left, a bonus page for the searches whose
 *      first page earned one (see `isWorthABonusPage`), most in-scope first.
 *
 * Google Jobs caps every page at SERPAPI_PAGE_SIZE (10, confirmed in
 * SerpApi's own docs — no parameter raises it), so a full, mostly-maritime
 * page is the signal there's more to give; measured live, a second page
 * costs exactly one more unit and returns entirely new jobs. But it was
 * previously fetched inline, right after its first page — and since the
 * day's slice is sized to the budget, every bonus page displaced a planned
 * search at the tail of the slice, which then didn't come round again for
 * a full rotation (~3 weeks). Observed on a live run: 4 of 16 secondary
 * searches "skipped, no budget left" behind 4 bonus pages. Bonus pages are
 * worth more than an untested combo, but not more than a planned one.
 * Capped at one bonus page per search so a single productive search can't
 * monopolize the leftover.
 */
const runSerpApiQueries = async (
  queries: ExternalJobQuery[],
  pool: ApiKeyPool,
): Promise<{ jobs: ExternalJob[]; spent: number }> => {
  const firstPages = await inChunks(
    queries,
    SERPAPI_CONCURRENCY,
    async (query) => ({
      query,
      ...(await fetchSerpApiPage(query, pool)),
    }),
  );

  const bonusCandidates = firstPages
    .filter(
      (
        run,
      ): run is typeof run & {
        page: SerpApiPage & { nextPageToken: string };
      } =>
        Boolean(run.page?.nextPageToken) &&
        isWorthABonusPage(run.page!.jobs, SERPAPI_PAGE_SIZE),
    )
    .sort((a, b) => inScopeRatio(b.page.jobs) - inScopeRatio(a.page.jobs));

  const bonusPages = await inChunks(
    bonusCandidates,
    SERPAPI_CONCURRENCY,
    async (run) => ({
      query: run.query,
      ...(await fetchSerpApiPage(run.query, pool, run.page.nextPageToken)),
    }),
  );
  const bonusByQuery = new Map(bonusPages.map((run) => [run.query, run]));

  const jobs: ExternalJob[] = [];
  let spent = 0;
  for (const run of firstPages) {
    spent += run.spent;
    if (!run.page) {
      console.log(
        `[external-jobs] SerpApi ${describeQuery(run.query)} -> skipped, no budget left`,
      );
      continue;
    }
    const bonus = bonusByQuery.get(run.query);
    spent += bonus?.spent ?? 0;
    const queryJobs = [...run.page.jobs, ...(bonus?.page?.jobs ?? [])];
    jobs.push(...queryJobs);
    logQueryYield(
      'SerpApi',
      run.query,
      queryJobs,
      bonus
        ? bonus.page
          ? 'bonus page'
          : 'bonus page skipped, no budget left'
        : undefined,
    );
  }
  return { jobs, spent };
};

/**
 * Gap left between JSearch calls. Hammering the endpoint back-to-back is
 * measurably counter-productive: six rapid identical calls returned 10, 2, 0,
 * 0, 0, 0 results while the quota counter decremented on every one — it
 * degrades to empty responses (HTTP 200, `status: OK`, no jobs) rather than
 * erroring, so nothing in the error handling below would ever notice. Pacing
 * is cheap here: this is a once-a-day cron, so even 18 queries only adds
 * about half a minute.
 */
const JSEARCH_INTER_QUERY_DELAY_MS = 2000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs JSearch queries in sequence (not parallel, unlike SerpApi) so it can
 * read `quotaRemaining` after each call and correct that key's budget — the
 * only quota signal JSearch offers. A key reporting empty is retired and the
 * page retried on another; once every key is spent the run stops.
 *
 * Bonus pages (via `cursor`) come in a second phase after every planned
 * search has had its first page — see runSerpApiQueries for why. The bonus
 * fetch goes through the same pacing delay as every other call here — it's
 * still a real request to the same endpoint, and skipping the delay is
 * exactly the rapid-fire pattern JSEARCH_INTER_QUERY_DELAY_MS's comment
 * measured as degrading results.
 */
const runJSearchQueries = async (
  queries: ExternalJobQuery[],
  pool: ApiKeyPool,
): Promise<{ jobs: ExternalJob[]; spent: number }> => {
  const collected: ExternalJob[] = [];
  let spent = 0;
  let isFirstCall = true;

  const attemptPage = async (query: ExternalJobQuery, cursor?: string) => {
    for (let attempt = 0; attempt < Math.max(1, pool.keyCount); attempt += 1) {
      const key = pool.take();
      if (!key) return null;

      if (!isFirstCall) await sleep(JSEARCH_INTER_QUERY_DELAY_MS);
      isFirstCall = false;

      try {
        const result = await fetchJSearchJobs(query, key, cursor);
        spent += 1;

        if (result.quotaRemaining !== null) {
          if (result.quotaRemaining <= 0) {
            console.warn(
              `[external-jobs] JSearch key ${maskApiKey(key)} reports 0 remaining — retiring it for this run`,
            );
            pool.markExhausted(key);
          } else {
            pool.clampRemaining(key, result.quotaRemaining);
          }
        }
        return result;
      } catch (error) {
        if (isJSearchQuotaError(error)) {
          console.warn(
            `[external-jobs] JSearch key ${maskApiKey(key)} is out of quota — retiring it for this run`,
          );
          pool.markExhausted(key);
          spent += 1;
          continue;
        }

        if (wasCharged(error)) spent += 1;
        else pool.refund(key);

        console.error(
          `[external-jobs] JSearch query failed (${describeQuery(query)}${cursor ? ' [bonus page]' : ''}):`,
          error instanceof Error ? error.message : error,
        );
        return null;
      }
    }
    return null;
  };

  // Phase 1: the first page of every planned search.
  const firstPages: {
    query: ExternalJobQuery;
    jobs: ExternalJob[];
    cursor: string | null;
  }[] = [];
  for (const query of queries) {
    const first = await attemptPage(query);

    if (!first) {
      // Only stop the whole run if the pool is genuinely out of live keys —
      // an ordinary per-query failure (network blip, bad response) just
      // moves on to the next query, same as before this was refactored.
      if (pool.liveKeyCount === 0) {
        console.log('[external-jobs] JSearch budget spent — stopping early');
        break;
      }
      continue;
    }
    firstPages.push({ query, jobs: first.jobs, cursor: first.cursor });
  }

  // Phase 2: bonus pages for the searches that earned one, most in-scope
  // first, with whatever budget is left — same reasoning as
  // runSerpApiQueries: a bonus page must never displace a planned search.
  const bonusCandidates = firstPages
    .filter(
      (run) => run.cursor && isWorthABonusPage(run.jobs, JSEARCH_PAGE_SIZE),
    )
    .sort((a, b) => inScopeRatio(b.jobs) - inScopeRatio(a.jobs));
  const bonusByQuery = new Map<ExternalJobQuery, ExternalJob[] | null>();
  for (const run of bonusCandidates) {
    if (pool.liveKeyCount === 0) break;
    const second = await attemptPage(run.query, run.cursor as string);
    bonusByQuery.set(run.query, second?.jobs ?? null);
  }

  for (const run of firstPages) {
    const bonus = bonusByQuery.get(run.query);
    const queryJobs = [...run.jobs, ...(bonus ?? [])];
    collected.push(...queryJobs);
    const earned = bonusCandidates.some((c) => c.query === run.query);
    logQueryYield(
      'JSearch',
      run.query,
      queryJobs,
      earned
        ? bonus
          ? 'bonus page'
          : 'bonus page skipped, no budget left'
        : undefined,
    );
  }

  return { jobs: collected, spent };
};

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
  /** Feed/ATS listings removed because today's full re-fetch no longer includes them. */
  fullRefreshRemoved: number;
  /** SerpApi/JSearch listings permanently deleted as expired (see expiry.ts). */
  expiredRemoved: number;
};

/**
 * Fetches every source and stores the result. Safe to run repeatedly — it's a
 * resync, not an append.
 *
 * Feed and ATS jobs (FULL_REFRESH_PROVIDERS) are refetched in full every run
 * (free, so no rotation needed) and pruned if missing from this run — a
 * genuine "no longer listed" signal, since the whole source is re-read every
 * time — but only for a source that returned listings this run (see
 * prune.ts's `prunablePrefixes`), so an outage or missing config never
 * wipes a company's jobs.
 *
 * SerpApi/JSearch listings are NOT pruned on rotation timing: each is only
 * re-confirmed when its query's turn comes back around (see queryGrid.ts),
 * which is not a signal that the listing has expired. Instead expiry.ts
 * permanently deletes the ones that are: links on expiry-prone re-posting
 * sites, links that now 404 or say "no longer available", and anything past
 * SEARCH_LISTING_MAX_AGE_DAYS from its real posted date.
 * The other way a scraped listing leaves the platform is admin moderation
 * (`hiddenByAdmin`, see adminExternalJobsController.ts) — always immediate,
 * regardless of age.
 */
export const refreshExternalJobs = async (): Promise<RefreshSummary> => {
  const runStartedAt = new Date();
  const dayIndex = rotationDayIndex(runStartedAt);

  const [serpApi, jSearch] = await Promise.all([
    isSerpApiConfigured()
      ? buildSerpApiPool()
      : Promise.resolve({
          pool: new ApiKeyPool([]),
          note: 'no SERPAPI_KEY configured',
        }),
    Promise.resolve(
      isJSearchConfigured()
        ? buildJSearchPool()
        : { pool: new ApiKeyPool([]), note: 'no JSEARCH_API_KEY configured' },
    ),
  ]);

  const serpApiBudget = applyConfiguredCap(
    serpApi.pool.totalAllowance,
    env.SERPAPI_MAX_QUERIES_PER_DAY,
  );
  const jSearchBudget = applyConfiguredCap(
    jSearch.pool.totalAllowance,
    env.JSEARCH_MAX_QUERIES_PER_DAY,
  );

  // Each provider only searches the countries it can actually answer for —
  // SerpApi skips the EEA markets where Google Jobs has no inventory (see
  // `noGoogleJobs` in queryGrid.ts), so that quota goes somewhere useful.
  const serpApiCountries = countriesFor('serpapi').length;
  const jSearchCountries = countriesFor('jsearch').length;

  // The floor always goes first and is never traded away for secondary
  // coverage — it's what guarantees every country the provider covers is
  // actually searched today, not just "sometime this rotation".
  const serpApiFloor = dailyFloorQueries(dayIndex, serpApiBudget, 'serpapi');
  const jSearchFloor = dailyFloorQueries(dayIndex, jSearchBudget, 'jsearch');

  const serpApiSecondary = pickRotationSlice(
    secondaryGridFor('serpapi'),
    dayIndex,
    serpApiBudget - serpApiFloor.length,
  );
  const jSearchSecondary = pickRotationSlice(
    secondaryGridFor('jsearch'),
    dayIndex,
    jSearchBudget - jSearchFloor.length,
  );

  const serpApiQueries = [...serpApiFloor, ...serpApiSecondary];
  const jSearchQueries = [...jSearchFloor, ...jSearchSecondary];

  console.log(
    `[external-jobs] query space: ${QUERY_GRID.length} combinations across ${MARITIME_COUNTRIES.length} countries (rotation day ${dayIndex})`,
  );
  console.log(
    `[external-jobs] SerpApi: ${serpApi.note} — ${serpApiFloor.length}/${serpApiCountries} countries on today's floor, ${serpApiSecondary.length} secondary search(es)`,
  );
  console.log(
    `[external-jobs] JSearch: ${jSearch.note} — ${jSearchFloor.length}/${jSearchCountries} countries on today's floor, ${jSearchSecondary.length} secondary search(es)`,
  );

  const [serpApiRun, jSearchRun, feedJobs, atsJobs] = await Promise.all([
    runSerpApiQueries(serpApiQueries, serpApi.pool),
    runJSearchQueries(jSearchQueries, jSearch.pool),
    fetchFeedJobs().catch((error) => {
      console.error('[external-jobs] Feed fetch failed:', error);
      return [] as ExternalJob[];
    }),
    fetchAtsJobs().catch((error) => {
      console.error('[external-jobs] ATS fetch failed:', error);
      return [] as ExternalJob[];
    }),
  ]);

  const serpApiJobs = serpApiRun.jobs;
  const serpApiSpent = serpApiRun.spent;

  const inScope = dedupeJobs(
    [...serpApiJobs, ...jSearchRun.jobs, ...feedJobs, ...atsJobs].filter(
      isInMaritimeScope,
    ),
  );

  // Dead, expired and unverifiable search results are dropped before they
  // can be saved — and removed if an earlier run had stored them.
  const verdict = await verifyFetchedSearchJobs(inScope, runStartedAt);
  if (verdict.rejectedIds.length > 0) {
    await prisma.externalJobListing.deleteMany({
      // Admin-hidden rows stay: they're tombstones against re-creation.
      where: { id: { in: verdict.rejectedIds }, hiddenByAdmin: false },
    });
  }
  const toStore = verdict.kept;

  await inChunks(toStore, DB_WRITE_CONCURRENCY, (job) =>
    upsertListing(job, runStartedAt),
  );

  const prunableSources = prunablePrefixes([...feedJobs, ...atsJobs]);

  const [{ count: fullRefreshRemoved }, { count: expiredRemoved }] =
    await Promise.all([
      prunableSources.length === 0
        ? Promise.resolve({ count: 0 })
        : prisma.externalJobListing.deleteMany({
            where: {
              provider: { in: [...FULL_REFRESH_PROVIDERS] },
              fetchedAt: { lt: runStartedAt },
              OR: prunableSources.map((prefix) => ({
                id: { startsWith: prefix },
              })),
            },
          }),
      purgeExpiredSearchListings({
        now: runStartedAt,
        verifiedSince: runStartedAt,
      }).then((purge) => ({ count: purge.total })),
    ]);

  const summary: RefreshSummary = {
    serpApiQueriesRun: serpApiSpent,
    serpApiQuotaNote: serpApi.note,
    jSearchQueriesRun: jSearchRun.spent,
    jSearchNote: jSearch.note,
    jobsFound: inScope.length,
    jobsStored: toStore.length,
    fullRefreshRemoved,
    expiredRemoved: expiredRemoved + verdict.rejectedIds.length,
  };

  console.log('[external-jobs] refresh complete:', summary);
  return summary;
};
