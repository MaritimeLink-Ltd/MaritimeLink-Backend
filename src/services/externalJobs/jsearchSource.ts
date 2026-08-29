import axios from 'axios';
import { env } from '../../config/env.js';
import { ExternalJob, ExternalJobQuery } from './types.js';
import { toAlpha2CountryCode } from './countryCodes.js';

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
 * (refresh.ts) stops issuing further JSearch queries for the rest of that
 * run once it reports the account is out.
 */

const JSEARCH_HOST = 'jsearch.p.rapidapi.com';
const REQUEST_TIMEOUT_MS = 20000;

type JSearchJobResult = {
  job_id?: string;
  job_title?: string;
  employer_name?: string;
  job_city?: string;
  job_country?: string;
  job_description?: string;
  job_apply_link?: string;
  job_publisher?: string;
  job_employment_type?: string;
  job_posted_at?: string;
  job_posted_at_datetime_utc?: string;
  job_posted_at_timestamp?: number;
};

type JSearchResponse = {
  status?: string;
  data?: {
    jobs?: JSearchJobResult[];
    cursor?: string;
  };
  error?: { message?: string };
};

export const isJSearchConfigured = () => Boolean(env.JSEARCH_API_KEY);

const buildLocation = (job: JSearchJobResult): string | null => {
  const parts = [job.job_city, job.job_country].filter((part): part is string =>
    Boolean(part?.trim()),
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

/** Exported for testing — pure, no network. */
export const normalizeJSearchJob = (
  job: JSearchJobResult,
): ExternalJob | null => {
  if (!job.job_id || !job.job_title) return null;

  return {
    id: `jsearch:${job.job_id}`,
    title: job.job_title,
    company: job.employer_name?.trim() || null,
    location: buildLocation(job),
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
): Promise<JSearchQueryResult> => {
  if (!env.JSEARCH_API_KEY) return { jobs: [], quotaRemaining: null };

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
        'X-RapidAPI-Key': env.JSEARCH_API_KEY,
        'X-RapidAPI-Host': JSEARCH_HOST,
      },
      params: {
        query: query.q,
        ...(countryCode ? { country: countryCode } : {}),
        num_pages: 1,
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

  const jobs = (response.data.data?.jobs ?? [])
    .map(normalizeJSearchJob)
    .filter((job): job is ExternalJob => job !== null);

  return { jobs, quotaRemaining };
};
