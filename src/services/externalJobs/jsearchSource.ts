import axios from 'axios';
import { env } from '../../config/env.js';
import { ExternalJob, ExternalJobQuery } from './types.js';
import { toAlpha2CountryCode } from './countryCodes.js';
import { resolveApiKeys } from './apiKeyPool.js';

/**
 * JSearch (RapidAPI), a second live job source independent of SerpApi —
 * different upstream aggregation (Indeed/LinkedIn/Glassdoor/Google Jobs),
 * different quota pool, so together they cover more ground than either
 * alone without either one being a single point of failure.
 *
 * Unlike SerpApi, JSearch has no free "check remaining quota" endpoint —
 * RapidAPI only reports usage via `x-ratelimit-requests-remaining` on real
 * (billable) responses. So there's no pre-flight budget check here; instead
 * `fetchJSearchJobs` surfaces that header on every call, and the caller
 * (refresh.ts) retires that key for the rest of the run once it reports the
 * account is out.
 *
 * Quota is metered per RapidAPI key, so calls take an explicit `apiKey` and
 * the caller pools several of them — see apiKeyPool.ts.
 */

const JSEARCH_HOST = 'jsearch.p.rapidapi.com';
const REQUEST_TIMEOUT_MS = 20000;

/**
 * Restricts every search to jobs posted within the last month.
 *
 * Unlike Google's dead `chips` parameter (see serpApiSource.ts), this is a
 * real, working JSearch parameter — measured live on the same query, with
 * pacing between calls so throttling couldn't skew it:
 *   date_posted=none  -> 10 results, half of them with no date at all
 *   date_posted=month -> 10 results, every one carrying a real date
 *   date_posted=week  -> 0 results
 *   date_posted=today -> 0 results
 * So `month` costs nothing in volume and strictly improves data quality by
 * dropping the undated stragglers. `week` is not viable: JSearch's index for
 * this vertical lags — on that run the freshest listing in the whole result
 * set was 12 days old, so nothing exists for a 7-day window to return.
 */
const DATE_POSTED_WINDOW = 'month';

type JSearchJobResult = {
  job_id?: string;
  job_title?: string;
  employer_name?: string;
  job_city?: string;
  /**
   * NOT trustworthy — do not use. Measured live: this field does not reflect
   * the job's real country, it silently echoes back whichever country code
   * the request asked for, even for jobs that are unambiguously elsewhere
   * (see isUsJob's comment for the reproduction). `job_state` is the field
   * that still carries the truth.
   */
  job_country?: string;
  job_state?: string;
  job_description?: string;
  job_apply_link?: string;
  job_publisher?: string;
  job_employment_type?: string;
  job_posted_at?: string;
  job_posted_at_datetime_utc?: string;
  job_posted_at_timestamp?: number;
};

/**
 * Full US state names (+ DC), matched against `job_state` to catch a real,
 * measured JSearch bug: when a query has thin or no genuine results for the
 * requested country, JSearch falls back to loosely keyword-matched US
 * postings instead of returning few/zero results — and stamps `job_country`
 * with the country code that was requested, not the job's real one.
 *
 * Measured live, reproduced across every market tried: "able seaman" @
 * Germany returned 9 of 10 jobs in Houston/Ingleside/Long Beach — genuine US
 * Gulf Coast maritime jobs — each carrying `job_country: "DE"`. "deck
 * officer" @ Nigeria returned 10 of 10 as Chicago listings, several not even
 * maritime (matched on the bare word "deck"). This isn't a rare edge case —
 * in these tests it was the majority or entirety of the result set.
 *
 * `job_state` is not a field this bug corrupts: every confirmed leak carried
 * a real US state name there, so it's the one reliable place the truth
 * survives. `job_country` is not used anywhere below — see its comment.
 */
const US_STATE_NAMES = new Set([
  'Alabama',
  'Alaska',
  'Arizona',
  'Arkansas',
  'California',
  'Colorado',
  'Connecticut',
  'Delaware',
  'Florida',
  'Georgia',
  'Hawaii',
  'Idaho',
  'Illinois',
  'Indiana',
  'Iowa',
  'Kansas',
  'Kentucky',
  'Louisiana',
  'Maine',
  'Maryland',
  'Massachusetts',
  'Michigan',
  'Minnesota',
  'Mississippi',
  'Missouri',
  'Montana',
  'Nebraska',
  'Nevada',
  'New Hampshire',
  'New Jersey',
  'New Mexico',
  'New York',
  'North Carolina',
  'North Dakota',
  'Ohio',
  'Oklahoma',
  'Oregon',
  'Pennsylvania',
  'Rhode Island',
  'South Carolina',
  'South Dakota',
  'Tennessee',
  'Texas',
  'Utah',
  'Vermont',
  'Virginia',
  'Washington',
  'West Virginia',
  'Wisconsin',
  'Wyoming',
  'District of Columbia',
]);

/**
 * True when a JSearch result is actually a US posting, whatever
 * `job_country` claims. Exported for testing — pure, no network.
 *
 * Note: "Georgia" is both a US state and a country name. None of our target
 * markets is the country Georgia today, so this can't misfire in practice —
 * flagging in case that market is ever added, since it would need a second
 * signal to disambiguate.
 */
export const isUsJob = (job: JSearchJobResult): boolean =>
  Boolean(job.job_state && US_STATE_NAMES.has(job.job_state.trim()));

type JSearchResponse = {
  status?: string;
  data?: {
    jobs?: JSearchJobResult[];
    cursor?: string;
  };
  error?: { message?: string };
};

/** Every configured JSearch key, in slot order. Each has its own monthly quota. */
export const resolveJSearchKeys = (): string[] =>
  resolveApiKeys([
    env.JSEARCH_API_KEY,
    env.JSEARCH_API_KEY_2,
    env.JSEARCH_API_KEY_3,
  ]);

export const isJSearchConfigured = () => resolveJSearchKeys().length > 0;

/**
 * True when an error means "this key is spent" rather than a transient fault.
 * RapidAPI answers an overrun monthly plan with 429, so that's the signal to
 * retire the key and retry the query on another one.
 */
export const isJSearchQuotaError = (error: unknown): boolean => {
  if (axios.isAxiosError(error) && error.response?.status === 429) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /exceeded the (monthly|daily) quota|too many requests|rate limit/i.test(
    message,
  );
};

/**
 * Builds the displayed location from the job's city plus the country we
 * actually searched for — not `job_country` (see its comment on why that
 * field is never used). A job only reaches this point after surviving
 * `isUsJob`, so the requested country is the trustworthy answer here.
 */
const buildLocation = (
  job: JSearchJobResult,
  targetCountryName: string | null,
): string | null => {
  const parts = [job.job_city, targetCountryName].filter(
    (part): part is string => Boolean(part?.trim()),
  );
  return parts.length ? parts.join(', ') : null;
};

const resolvePostedAt = (job: JSearchJobResult): string | null => {
  if (job.job_posted_at_datetime_utc) return job.job_posted_at_datetime_utc;
  if (typeof job.job_posted_at_timestamp === 'number') {
    const parsed = new Date(job.job_posted_at_timestamp * 1000);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return job.job_posted_at ?? null;
};

/**
 * Exported for testing — pure, no network. `targetCountryName` is the
 * country the query actually searched for (e.g. "Netherlands"); pass it so
 * the built location reflects a trustworthy country, not `job_country`.
 */
export const normalizeJSearchJob = (
  job: JSearchJobResult,
  targetCountryName: string | null = null,
): ExternalJob | null => {
  if (!job.job_id || !job.job_title) return null;

  return {
    id: `jsearch:${job.job_id}`,
    title: job.job_title,
    company: job.employer_name?.trim() || null,
    location: buildLocation(job, targetCountryName),
    description: job.job_description ?? '',
    salary: null,
    postedAt: resolvePostedAt(job),
    applyLink: job.job_apply_link ?? null,
    via: job.job_publisher?.trim() || null,
    thumbnail: null,
    // Same reasoning as SerpApi: no clean occupational category upstream.
    category: null,
    employmentType: job.job_employment_type ?? null,
    source: 'external',
    provider: 'jsearch',
  };
};

export type JSearchQueryResult = {
  jobs: ExternalJob[];
  /** From `x-ratelimit-requests-remaining`; null when the header was absent. */
  quotaRemaining: number | null;
};

/** Runs one search. Throws on transport or API error; the caller decides. */
export const fetchJSearchJobs = async (
  query: ExternalJobQuery,
  apiKey: string,
): Promise<JSearchQueryResult> => {
  if (!apiKey) return { jobs: [], quotaRemaining: null };

  const countryCode = query.location
    ? toAlpha2CountryCode(query.location)
    : null;

  // Note: this account's plan exposes /search-v2, not the older /search path
  // documented for some JSearch tiers — confirmed against a live call.
  const response = await axios.get<JSearchResponse>(
    `https://${JSEARCH_HOST}/search-v2`,
    {
      timeout: REQUEST_TIMEOUT_MS,
      headers: {
        'X-RapidAPI-Key': apiKey,
        'X-RapidAPI-Host': JSEARCH_HOST,
      },
      params: {
        query: query.q,
        ...(countryCode ? { country: countryCode } : {}),
        num_pages: 1,
        date_posted: DATE_POSTED_WINDOW,
      },
    },
  );

  if (
    response.data.error ||
    (response.data.status && response.data.status !== 'OK')
  ) {
    throw new Error(
      `JSearch: ${response.data.error?.message ?? response.data.status ?? 'unknown error'}`,
    );
  }

  const remainingHeader = response.headers?.['x-ratelimit-requests-remaining'];
  const quotaRemaining =
    remainingHeader !== undefined && !Number.isNaN(Number(remainingHeader))
      ? Number(remainingHeader)
      : null;

  // Drop the US-leak jobs before normalizing — see isUsJob's comment. This
  // must happen on the raw result: job_state (the only reliable signal)
  // isn't carried into the normalized ExternalJob shape.
  const jobs = (response.data.data?.jobs ?? [])
    .filter((job) => !isUsJob(job))
    .map((job) => normalizeJSearchJob(job, query.location ?? null))
    .filter((job): job is ExternalJob => job !== null);

  return { jobs, quotaRemaining };
};
