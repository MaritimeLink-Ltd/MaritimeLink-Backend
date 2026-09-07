import axios from 'axios';
import { fetchFeedJobs } from './feedSource.js';
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
import { isInMaritimeScope } from './scope.js';
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
 * Daily refresh: the only place that calls out to SerpApi, JSearch, or the
 * syndicated feeds. Run once a day by a scheduled job (see
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
 * budget is left over, which rotates through the rank-specific and
 * city-level searches in `SECONDARY_GRID` (rotation.ts), sized to however
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

/**
 * Runs one SerpApi search — and, when the page comes back full, one bonus
 * page right after it — moving to another key if the one it drew turns out
 * to be spent. A page is only abandoned once every key has been tried — a
 * search lost to an exhausted key would otherwise wait a full rotation for
 * its next turn.
 *
 * The bonus page: Google Jobs caps every page at SERPAPI_PAGE_SIZE (10,
 * confirmed in SerpApi's own docs — no parameter raises it), so a full page
 * is the signal there's more to give. Measured live, a second page costs
 * exactly one more search unit — same as the first — and returns entirely
 * new jobs. That's a better use of the next unit of budget than gambling it
 * on an untested (term, country) combo elsewhere in today's rotation, which
 * this grid's own measurements show often returns 0. Capped at one bonus
 * page per query so a single productive query can't monopolize the day.
 */
const runSerpApiQuery = async (
  query: ExternalJobQuery,
  pool: ApiKeyPool,
): Promise<{ jobs: ExternalJob[]; spent: number }> => {
  let spent = 0;

  const attemptPage = async (
    pageToken?: string,
  ): Promise<{ jobs: ExternalJob[]; nextPageToken: string | null } | null> => {
    for (let attempt = 0; attempt < Math.max(1, pool.keyCount); attempt += 1) {
      const key = pool.take();
      if (!key) return null;

      try {
        const result = await fetchSerpApiJobs(query, key, pageToken);
        spent += 1;
        return result;
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
        return null;
      }
    }
    return null;
  };

  const first = await attemptPage();
  if (!first) return { jobs: [], spent };

  if (first.jobs.length >= SERPAPI_PAGE_SIZE && first.nextPageToken) {
    const second = await attemptPage(first.nextPageToken);
    if (second) return { jobs: [...first.jobs, ...second.jobs], spent };
  }

  return { jobs: first.jobs, spent };
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
 * Also fetches one bonus page (via `cursor`) right after any page that comes
 * back full — same reasoning as SerpApi's bonus page (see runSerpApiQuery):
 * a full page signals more genuine supply, which is a better use of the next
 * budget unit than an untested combo elsewhere in the rotation. Capped at
 * one bonus page per query. The bonus fetch goes through the same pacing
 * delay as every other call here — it's still a real request to the same
 * endpoint, and skipping the delay is exactly the rapid-fire pattern
 * JSEARCH_INTER_QUERY_DELAY_MS's comment measured as degrading results.
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

  for (const query of queries) {
    const first = await attemptPage(query);

    if (!first) {
      // Only stop the whole run if the pool is genuinely out of live keys —
      // an ordinary per-query failure (network blip, bad response) just
      // moves on to the next query, same as before this was refactored.
      if (pool.liveKeyCount === 0) {
        console.log('[external-jobs] JSearch budget spent — stopping early');
        return { jobs: collected, spent };
      }
      continue;
    }

    collected.push(...first.jobs);

    if (first.jobs.length >= JSEARCH_PAGE_SIZE && first.cursor) {
      const second = await attemptPage(query, first.cursor);
      if (second) collected.push(...second.jobs);
    }
  }

  return { jobs: collected, spent };
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

/**
 * How long a SerpApi/JSearch listing may sit on the platform before it's
 * treated as expired, regardless of the rotation.
 *
 * Deliberately a fixed, generous window rather than one derived from the
 * rotation's cycle speed (the earlier design): that coupling meant a listing
 * could be deleted purely because its query hadn't come back around yet, as
 * often as every 6-10 days depending on that day's budget — indistinguishable
 * from the listing actually being gone, and it isn't. 21 days (3 weeks) is
 * comfortably longer than the secondary rotation's cycle time at any
 * realistic key count (5-15 days — see queryGrid.ts), so a listing is never
 * caught by this while still waiting its normal turn to be re-confirmed; it
 * only catches listings that have genuinely been on the platform for weeks.
 */
const LISTING_RETENTION_DAYS = 21;

/** Anchored on `createdAt` — see the comment on `LISTING_RETENTION_DAYS`. */
const retentionCutoff = (now: Date, days: number): Date =>
  new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

export type RefreshSummary = {
  serpApiQueriesRun: number;
  serpApiQuotaNote: string;
  jSearchQueriesRun: number;
  jSearchNote: string;
  jobsFound: number;
  jobsStored: number;
  /** Feed listings removed because today's full re-fetch no longer includes them. */
  feedRemoved: number;
  /** SerpApi/JSearch listings removed for exceeding LISTING_RETENTION_DAYS. */
  expiredRemoved: number;
};

/**
 * Fetches every source and stores the result. Safe to run repeatedly — it's a
 * resync, not an append.
 *
 * Feed jobs are refetched in full every run (free, so no rotation needed) and
 * pruned if missing from this run — a genuine "no longer listed" signal, since
 * the whole feed is re-read every time.
 *
 * SerpApi/JSearch listings are NOT pruned on rotation timing: each is only
 * re-confirmed when its query's turn comes back around (see queryGrid.ts),
 * which is not a signal that the listing has expired, so deleting on that
 * basis would remove listings a professional saw only days ago. Instead:
 *   - Age is handled through *ranking* first — getExternalJobsForProfessional
 *     always sorts newest-first, so older listings sink toward the bottom of
 *     their band rather than disappearing.
 *   - `createdAt` (first-seen, never touched by the upsert below) is checked
 *     against a fixed LISTING_RETENTION_DAYS window as a hard backstop, so
 *     the table doesn't grow forever with listings that are, realistically,
 *     long expired. `createdAt` rather than `fetchedAt` on purpose — the
 *     latter only reflects when the rotation last happened to touch this
 *     listing, not how long it's actually been on the platform.
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

  const [serpApiRuns, jSearchRun, feedJobs] = await Promise.all([
    inChunks(serpApiQueries, SERPAPI_CONCURRENCY, (query) =>
      runSerpApiQuery(query, serpApi.pool),
    ),
    runJSearchQueries(jSearchQueries, jSearch.pool),
    fetchFeedJobs().catch((error) => {
      console.error('[external-jobs] Feed fetch failed:', error);
      return [] as ExternalJob[];
    }),
  ]);

  const serpApiJobs = serpApiRuns.flatMap((run) => run.jobs);
  const serpApiSpent = serpApiRuns.reduce((total, run) => total + run.spent, 0);

  const inScope = dedupeJobs(
    [...serpApiJobs, ...jSearchRun.jobs, ...feedJobs].filter(isInMaritimeScope),
  );

  await inChunks(inScope, DB_WRITE_CONCURRENCY, (job) =>
    upsertListing(job, runStartedAt),
  );

  const [{ count: feedRemoved }, { count: expiredRemoved }] = await Promise.all(
    [
      prisma.externalJobListing.deleteMany({
        where: { provider: 'feed', fetchedAt: { lt: runStartedAt } },
      }),
      prisma.externalJobListing.deleteMany({
        where: {
          provider: { in: ['serpapi', 'jsearch'] },
          createdAt: {
            lt: retentionCutoff(runStartedAt, LISTING_RETENTION_DAYS),
          },
        },
      }),
    ],
  );

  const summary: RefreshSummary = {
    serpApiQueriesRun: serpApiSpent,
    serpApiQuotaNote: serpApi.note,
    jSearchQueriesRun: jSearchRun.spent,
    jSearchNote: jSearch.note,
    jobsFound: inScope.length,
    jobsStored: inScope.length,
    feedRemoved,
    expiredRemoved,
  };

  console.log('[external-jobs] refresh complete:', summary);
  return summary;
};
