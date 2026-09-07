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
  job_state?: string;
  /**
   * NOT trustworthy — do not use. Measured live: this field does not reflect
   * the job's real country, it silently echoes back whichever country code
   * the request asked for, even for jobs that are unambiguously elsewhere
   * (see `verifyJobCountry`'s comment for the reproduction). `job_city` /
   * `job_state` are the fields that still carry the truth.
   */
  job_country?: string;
  /**
   * Does NOT mean "location-agnostic" — measured live, a job marked remote
   * still carries a real (often wrong-country) `job_state`, e.g.
   * `job_state: "New York"` on a listing returned for a United Kingdom
   * search. Only trusted as a pass when there's no city/state to check at
   * all — see `verifyJobCountry`.
   */
  job_is_remote?: boolean;
  job_description?: string;
  job_apply_link?: string;
  job_publisher?: string;
  job_employment_type?: string;
  job_posted_at?: string;
  job_posted_at_datetime_utc?: string;
  job_posted_at_timestamp?: number;
};

/**
 * The free-text place JSearch actually gives us to verify against — city
 * plus state/region when both are present, for tighter disambiguation
 * (SerpApi's locations database resolves "Cheney, Kansas" more precisely
 * than bare "Cheney"). Exported for testing — pure, no network.
 */
export const buildVerifiablePlace = (job: JSearchJobResult): string | null => {
  const parts = [job.job_city, job.job_state].filter((part): part is string =>
    Boolean(part?.trim()),
  );
  return parts.length ? parts.join(', ') : null;
};

/**
 * Free, unmetered SerpApi endpoint (no API key needed) — the same one used
 * to verify the canonical hub-city strings in queryGrid.ts. Resolves
 * free-text place names to a real ISO country code via Google's own location
 * database, which is what makes it possible to check JSearch's claims
 * against reality instead of trusting fields JSearch itself corrupts.
 */
const LOCATIONS_ENDPOINT = 'https://serpapi.com/locations.json';
const LOCATIONS_TIMEOUT_MS = 15000;

/**
 * Looks up a free-text place and returns its lowercase ISO country code, or
 * null when nothing resolves or the request fails. Not unit tested directly
 * (network-dependent, verified live — see `verifyJobCountry`'s comment for
 * the measurements) — same convention as this codebase's other
 * network-touching helpers (e.g. serpApiSource.ts's getSerpApiQuota).
 */
const resolvePlaceCountryCode = async (
  place: string,
): Promise<string | null> => {
  try {
    const response = await axios.get<Array<{ country_code?: string }>>(
      LOCATIONS_ENDPOINT,
      { params: { q: place, limit: 1 }, timeout: LOCATIONS_TIMEOUT_MS },
    );
    return response.data?.[0]?.country_code?.toLowerCase() ?? null;
  } catch {
    return null;
  }
};

/**
 * True when a JSearch result's real place actually belongs to the country we
 * searched for. This replaces an earlier, narrower fix (`isUsJob`, matching
 * `job_state` against a US-state list) that only caught part of the problem:
 * JSearch doesn't just leak US jobs into other countries' searches, it leaks
 * jobs from ANY wrong country, and stamps `job_country` with whatever code
 * was requested regardless. All three measured live, after the US-only fix
 * had already shipped:
 *   - a genuine Frankfurt, Germany job returned for a Kenya search
 *   - a genuine London, UK job returned for a Nigeria search
 *   - a genuine Washington DC, US federal job returned for a South Africa
 *     search — `job_state` came through as "DC", not "District of Columbia",
 *     so even the old US-name list would have missed this specific one
 * Checking against real geography (via `resolvePlaceCountryCode`) generalizes
 * past all of these, rather than extending a country/abbreviation list every
 * time a new leak shape turns up.
 *
 * A job with no city or state to check at all is only trusted when JSearch
 * marked it `job_is_remote` — but a job that DOES carry a place is still
 * checked even when marked remote (see `job_is_remote`'s comment on the
 * type): "remote" here means remote within that job's own country, not
 * location-agnostic.
 */
export const verifyJobCountry = async (
  job: JSearchJobResult,
  targetCountryCode: string,
): Promise<boolean> => {
  const place = buildVerifiablePlace(job);
  if (!place) return job.job_is_remote === true;

  const resolved = await resolvePlaceCountryCode(place);
  return resolved === targetCountryCode.toLowerCase();
};

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
 * True when an error means "stop using this specific key for the rest of the
 * run" — either its quota is spent (429) or its RapidAPI subscription itself
 * is broken (403, e.g. lapsed/cancelled — `{"message":"You are not
 * subscribed to this API."}`). Both are permanent for the run, unlike a
 * transient network fault, and the fix is identical: retire the key and
 * retry the query on another one.
 *
 * The 403 case is not hypothetical — observed live in production: a key
 * whose subscription had lapsed sat in the round-robin pool failing on every
 * single turn it got, since a 403 wasn't previously recognized as
 * key-retiring. Across one real run that cost 6 of 18 JSearch searches (a
 * third of the day's budget) to a key that could never succeed — exactly
 * the kind of waste this function exists to prevent.
 */
export const isJSearchQuotaError = (error: unknown): boolean => {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    if (status === 429 || status === 403) return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return /exceeded the (monthly|daily) quota|too many requests|rate limit|not subscribed/i.test(
    message,
  );
};

/**
 * Builds the displayed location from the job's city plus the country we
 * actually searched for — not `job_country` (see its comment on why that
 * field is never used). A job only reaches this point after surviving
 * `verifyJobCountry`, so the requested country is the trustworthy answer
 * when there's a real city to pair it with.
 *
 * A cityless job only gets here by being marked remote with nothing else to
 * verify (see `verifyJobCountry`) — naming a specific country in that case
 * would claim a certainty we don't actually have, so it's labelled "Remote"
 * instead.
 */
const buildLocation = (
  job: JSearchJobResult,
  targetCountryName: string | null,
): string | null => {
  if (!job.job_city?.trim()) return job.job_is_remote ? 'Remote' : null;

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

/**
 * JSearch returns at most this many jobs per page/cursor step — measured
 * live (10 jobs, every time). A full page is the signal `fetchJSearchJobs`'s
 * caller uses to decide whether a bonus page is worth its own search unit.
 */
export const JSEARCH_PAGE_SIZE = 10;

export type JSearchQueryResult = {
  jobs: ExternalJob[];
  /** From `x-ratelimit-requests-remaining`; null when the header was absent. */
  quotaRemaining: number | null;
  /**
   * Pass back as `cursor` to fetch the next page. Measured live: costs a
   * full search unit, same as the first page, and returns entirely new jobs
   * (0% overlap) — no bulk discount for asking for more per call, but no
   * penalty either over spending that unit on a different query.
   */
  cursor: string | null;
};

/**
 * Runs one search. Throws on transport or API error; the caller decides.
 *
 * Pass `cursor` (from a prior call's result) to fetch the page after it.
 * Confirmed live to be equivalent to (not cheaper than) `num_pages`: both
 * bill 1 unit per page of up to JSEARCH_PAGE_SIZE — cursor is used here
 * because it's what /search-v2 (this account's plan) actually documents,
 * while `num_pages` also happened to work when tested but isn't its
 * documented pagination mechanism.
 */
export const fetchJSearchJobs = async (
  query: ExternalJobQuery,
  apiKey: string,
  cursor?: string,
): Promise<JSearchQueryResult> => {
  if (!apiKey) return { jobs: [], quotaRemaining: null, cursor: null };

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
        ...(cursor ? { cursor } : { num_pages: 1 }),
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

  const rawJobs = response.data.data?.jobs ?? [];

  // Verify each job's real place against the country we searched for before
  // normalizing — see verifyJobCountry's comment for why job_country/
  // job_is_remote alone can't be trusted for this. Runs in parallel: at most
  // ~10 jobs per call, each a free/unmetered lookup.
  const verifiedJobs: JSearchJobResult[] = countryCode
    ? (
        await Promise.all(
          rawJobs.map(async (job) =>
            (await verifyJobCountry(job, countryCode)) ? job : null,
          ),
        )
      ).filter((job): job is JSearchJobResult => job !== null)
    : rawJobs;

  const jobs = verifiedJobs
    .map((job) => normalizeJSearchJob(job, query.location ?? null))
    .filter((job): job is ExternalJob => job !== null);

  return { jobs, quotaRemaining, cursor: response.data.data?.cursor ?? null };
};
