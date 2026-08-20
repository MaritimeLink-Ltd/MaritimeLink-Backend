import { prisma } from '../../config/prisma.js';
import { dedupeJobs } from './dedupe.js';
import { fetchFeedJobs } from './feedSource.js';
import { CATEGORY_SEARCH_TERMS, scopeToMaritime } from './profileQuery.js';
import { fetchSerpApiJobs, isSerpApiConfigured } from './serpApiSource.js';
import { isInMaritimeScope } from './scope.js';
import { ExternalJob, ExternalJobQuery } from './types.js';

/**
 * Daily refresh: the only place that calls out to SerpApi or the syndicated
 * feeds. Run once a day by a scheduled job (see scripts/refresh-external-jobs.ts),
 * never by a user request — `getExternalJobsForProfessional` only reads what
 * this writes to `external_job_listings`.
 *
 * Because the shared pool has no per-professional location or exact rank
 * string to search with, coverage comes from casting a bounded net instead:
 * generic maritime searches, one search per platform category, the most
 * common ranks on the platform, and the most common countries. Every
 * professional is then ranked against the whole pool at request time — a
 * rank that wasn't searched for directly can still surface through keyword,
 * skill and sea-service matching in `scoreProfessionalForJob`.
 */

/** Identical for everyone; keeps the pool populated even with no rank data. */
const BASELINE_QUERIES: ExternalJobQuery[] = [
  { q: 'maritime seafarer jobs' },
  { q: 'ship crew vessel jobs' },
];

/** How many distinct professional ranks to search for by name. */
const MAX_RANK_QUERIES = 20;

/** How many professional countries to add a location-scoped baseline search for. */
const MAX_COUNTRY_QUERIES = 5;

/**
 * Hard ceiling on SerpApi calls per run, bounding daily spend regardless of
 * how many distinct ranks/countries exist on the platform.
 */
const MAX_SERPAPI_QUERIES = 40;

const clean = (value: unknown) => String(value ?? '').trim();

/** Counts non-empty values case-insensitively, keeping the first-seen casing. */
const rankByFrequency = (values: Array<string | null | undefined>) => {
  const counts = new Map<string, { term: string; count: number }>();
  for (const raw of values) {
    const term = clean(raw);
    if (!term) continue;
    const key = term.toLowerCase();
    const entry = counts.get(key);
    if (entry) entry.count += 1;
    else counts.set(key, { term, count: 1 });
  }
  return [...counts.values()].sort((a, b) => b.count - a.count);
};

/** The N most common ranks on the platform, each turned into a maritime-scoped search. */
const collectRankQueries = async (): Promise<ExternalJobQuery[]> => {
  const professionals = await prisma.professional.findMany({
    select: { subcategory: true, resume: { select: { subcategory: true } } },
  });

  const ranks = rankByFrequency(
    professionals.map((p) => p.subcategory || p.resume?.subcategory),
  ).slice(0, MAX_RANK_QUERIES);

  return ranks.map(({ term }) => ({ q: scopeToMaritime(term) }));
};

/** The generic baseline search, scoped to each of the M most common professional countries. */
const collectCountryQueries = async (): Promise<ExternalJobQuery[]> => {
  const resumes = await prisma.professionalResume.findMany({
    select: { country: true },
  });

  const countries = rankByFrequency(resumes.map((r) => r.country)).slice(
    0,
    MAX_COUNTRY_QUERIES,
  );

  return countries.map(({ term }) => ({
    q: BASELINE_QUERIES[0].q,
    location: term,
  }));
};

const queryKey = (query: ExternalJobQuery) =>
  `${query.q.toLowerCase()}|${(query.location ?? '').toLowerCase()}`;

const buildQueryPlan = async (): Promise<ExternalJobQuery[]> => {
  const categoryQueries = Object.values(CATEGORY_SEARCH_TERMS).map((term) => ({
    q: term,
  }));

  const [rankQueries, countryQueries] = await Promise.all([
    collectRankQueries(),
    collectCountryQueries(),
  ]);

  const all = [
    ...BASELINE_QUERIES,
    ...categoryQueries,
    ...rankQueries,
    ...countryQueries,
  ];

  const seen = new Set<string>();
  const deduped: ExternalJobQuery[] = [];
  for (const query of all) {
    const key = queryKey(query);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(query);
  }

  return deduped.slice(0, MAX_SERPAPI_QUERIES);
};

/**
 * This only runs once a day, so a single transient timeout otherwise costs
 * that search the whole day rather than a few extra seconds — worth one retry.
 */
const runSerpApiQuery = async (
  query: ExternalJobQuery,
): Promise<ExternalJob[]> => {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      return await fetchSerpApiJobs(query);
    } catch (error) {
      const label = `"${query.q}"${query.location ? ` @ ${query.location}` : ''}`;
      if (attempt === 2) {
        console.error(
          `[external-jobs] SerpApi query failed after retry (${label}):`,
          error instanceof Error ? error.message : error,
        );
        return [];
      }
      console.warn(`[external-jobs] SerpApi query failed, retrying (${label})`);
    }
  }
  return [];
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
  jobsFound: number;
  jobsStored: number;
  staleRemoved: number;
};

/**
 * Fetches every source, stores the result, and removes listings no source
 * returned any more. Safe to run repeatedly — it's a full resync, not an
 * append.
 */
export const refreshExternalJobs = async (): Promise<RefreshSummary> => {
  const runStartedAt = new Date();

  if (!isSerpApiConfigured()) {
    console.warn(
      '[external-jobs] SERPAPI_KEY not set — refreshing feeds only.',
    );
  }

  const queries = await buildQueryPlan();

  const [serpApiResults, feedJobs] = await Promise.all([
    isSerpApiConfigured()
      ? inChunks(queries, SERPAPI_CONCURRENCY, runSerpApiQuery)
      : Promise.resolve([] as ExternalJob[][]),
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

  const { count: staleRemoved } = await prisma.externalJobListing.deleteMany({
    where: { fetchedAt: { lt: runStartedAt } },
  });

  const summary: RefreshSummary = {
    queriesRun: queries.length,
    jobsFound: inScope.length,
    jobsStored: inScope.length,
    staleRemoved,
  };

  console.log('[external-jobs] refresh complete:', summary);
  return summary;
};
