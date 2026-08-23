import axios from 'axios';
import { env } from '../../config/env.js';
import { ExternalJob, ExternalJobQuery } from './types.js';

/** Google Jobs results, via SerpApi's hosted API. */

type SerpApiJobResult = {
  job_id: string;
  title: string;
  company_name?: string;
  location?: string;
  description?: string;
  via?: string;
  thumbnail?: string;
  detected_extensions?: {
    posted_at?: string;
    salary?: string;
    schedule_type?: string;
  };
  apply_options?: Array<{ title?: string; link?: string }>;
};

type SerpApiResponse = {
  jobs_results?: SerpApiJobResult[];
  error?: string;
};

const REQUEST_TIMEOUT_MS = 20000;

const stripVia = (via: unknown) =>
  String(via ?? '')
    .replace(/^via\s+/i, '')
    .trim() || null;

const normalize = (job: SerpApiJobResult): ExternalJob => ({
  id: `serpapi:${job.job_id}`,
  title: job.title,
  company: job.company_name?.trim() || null,
  location: job.location?.trim() || null,
  description: job.description ?? '',
  salary: job.detected_extensions?.salary ?? null,
  postedAt: job.detected_extensions?.posted_at ?? null,
  applyLink: job.apply_options?.find((option) => option.link)?.link ?? null,
  via: stripVia(job.via),
  thumbnail: job.thumbnail ?? null,
  // Google Jobs exposes no occupational category — only a schedule type, which
  // is employment terms, not a category. Feeding it to the matcher as a
  // category would compare "Full-time" against a professional's rank.
  category: null,
  employmentType: job.detected_extensions?.schedule_type ?? null,
  source: 'external',
  provider: 'serpapi',
});

export const isSerpApiConfigured = () => Boolean(env.SERPAPI_KEY);

type SerpApiAccountResponse = {
  plan_id?: string;
  searches_per_month?: number;
  total_searches_left?: number;
  this_month_usage?: number;
};

export type SerpApiQuota = {
  planId: string | null;
  searchesLeft: number;
  monthlyLimit: number | null;
};

/**
 * Checks the account's actual remaining quota before spending it — this is a
 * free/unmetered endpoint on SerpApi's side, not a search. Returns null if the
 * check itself fails, so the caller can fall back to a configured guess rather
 * than blocking the refresh on a transient network error.
 */
export const getSerpApiQuota = async (): Promise<SerpApiQuota | null> => {
  if (!env.SERPAPI_KEY) return null;

  try {
    const response = await axios.get<SerpApiAccountResponse>(
      'https://serpapi.com/account.json',
      { timeout: REQUEST_TIMEOUT_MS, params: { api_key: env.SERPAPI_KEY } },
    );
    return {
      planId: response.data.plan_id ?? null,
      searchesLeft: response.data.total_searches_left ?? 0,
      monthlyLimit: response.data.searches_per_month ?? null,
    };
  } catch (error) {
    console.error(
      '[external-jobs] Failed to check SerpApi quota:',
      error instanceof Error ? error.message : error,
    );
    return null;
  }
};

/** Runs one search. Throws on transport or API error; the caller decides. */
export const fetchSerpApiJobs = async (
  query: ExternalJobQuery,
): Promise<ExternalJob[]> => {
  if (!env.SERPAPI_KEY) return [];

  const response = await axios.get<SerpApiResponse>(
    'https://serpapi.com/search.json',
    {
      timeout: REQUEST_TIMEOUT_MS,
      params: {
        engine: 'google_jobs',
        q: query.q,
        ...(query.location ? { location: query.location } : {}),
        // Without this, Google localizes titles/locations into the target
        // country's language (e.g. Russian for `location: Russia`) — pin to
        // English since that's what the matcher and the UI expect.
        hl: 'en',
        api_key: env.SERPAPI_KEY,
      },
    },
  );

  if (response.data.error) {
    // "no results" is a normal outcome for a narrow rank or location, not a
    // fault — report it as empty so the caller can widen the search instead.
    if (/hasn't returned any results|no results/i.test(response.data.error)) {
      return [];
    }
    throw new Error(`SerpApi: ${response.data.error}`);
  }

  return (response.data.jobs_results ?? [])
    .filter((job) => job.job_id && job.title)
    .map(normalize);
};
