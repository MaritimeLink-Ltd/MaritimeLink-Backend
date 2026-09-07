import axios from 'axios';
import { env } from '../../config/env.js';
import { ExternalJob, ExternalJobQuery } from './types.js';
import { resolveApiKeys } from './apiKeyPool.js';

/**
 * Google Jobs results, via SerpApi's hosted API.
 *
 * Every call takes an explicit `apiKey` rather than reading env directly:
 * quota is metered per key, so the caller (refresh.ts) pools several keys and
 * decides which one each search should spend — see apiKeyPool.ts.
 */

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
  serpapi_pagination?: { next_page_token?: string };
};

const REQUEST_TIMEOUT_MS = 20000;

/**
 * Google Jobs returns at most this many results per page — confirmed in
 * SerpApi's own docs ("Up to 10 results are returned per page"), no
 * parameter raises it. A full page is the signal `fetchSerpApiJobs`'s caller
 * uses to decide whether a second page is worth its own search unit.
 */
export const SERPAPI_PAGE_SIZE = 10;

/**
 * No date filter is sent to Google Jobs, deliberately.
 *
 * Google's `chips=date_posted:...` parameter does NOT work and must not be
 * reintroduced: measured live, the identical query `q=marine engineer`
 * @ United Kingdom returns 10 results bare, and **0 results** with
 * `chips=date_posted:week` or `:today` ("Google hasn't returned any results
 * for this query"). The UK plainly has marine engineer jobs posted that
 * week, so the parameter isn't filtering — it's breaking the query. Google
 * has moved these filters to opaque per-query `uds` tokens, which the API
 * only hands back in the `filters` array of a response, so using one would
 * cost a second search per query — not affordable on a metered free tier.
 *
 * Freshness is handled where it actually works instead: JSearch's real
 * `date_posted` parameter (jsearchSource.ts), newest-first ranking at read
 * time (externalJobs/index.ts), and the retention window (refresh.ts).
 */

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

/** Every configured SerpApi key, in slot order. Each has its own monthly quota. */
export const resolveSerpApiKeys = (): string[] =>
  resolveApiKeys([env.SERPAPI_KEY, env.SERPAPI_KEY_2, env.SERPAPI_KEY_3]);

export const isSerpApiConfigured = () => resolveSerpApiKeys().length > 0;

/**
 * True when an error means "this key is spent", as opposed to a bad query or
 * a transient fault — the caller retires the key and retries elsewhere rather
 * than burning the rest of the run on it.
 */
export const isSerpApiQuotaError = (error: unknown): boolean => {
  if (axios.isAxiosError(error) && error.response?.status === 429) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /run out of searches|ran out of searches|quota|exceeded your|too many requests/i.test(
    message,
  );
};

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
export const getSerpApiQuota = async (
  apiKey: string,
): Promise<SerpApiQuota | null> => {
  if (!apiKey) return null;

  try {
    const response = await axios.get<SerpApiAccountResponse>(
      'https://serpapi.com/account.json',
      { timeout: REQUEST_TIMEOUT_MS, params: { api_key: apiKey } },
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

export type SerpApiJobsResult = {
  jobs: ExternalJob[];
  /**
   * Present when Google reports more results exist beyond this page — pass
   * it back as `nextPageToken` to fetch the next one. Costs a full search
   * unit just like the first page (confirmed live), so the caller should
   * only spend it when there's budget to spare, not unconditionally.
   */
  nextPageToken: string | null;
};

/**
 * Runs one search. Throws on transport or API error; the caller decides.
 *
 * Pass `nextPageToken` (from a prior call's result) to fetch the page after
 * it — SerpApi requires the original `q`/`location`/`hl` to be resent
 * alongside the token, not just the token alone (confirmed live: the token
 * by itself errors with "Missing query `q` parameter").
 */
export const fetchSerpApiJobs = async (
  query: ExternalJobQuery,
  apiKey: string,
  nextPageToken?: string,
): Promise<SerpApiJobsResult> => {
  if (!apiKey) return { jobs: [], nextPageToken: null };

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
        ...(nextPageToken ? { next_page_token: nextPageToken } : {}),
        api_key: apiKey,
      },
    },
  );

  if (response.data.error) {
    // "no results" is a normal outcome for a narrow rank or location, not a
    // fault — report it as empty so the caller can widen the search instead.
    if (/hasn't returned any results|no results/i.test(response.data.error)) {
      return { jobs: [], nextPageToken: null };
    }
    throw new Error(`SerpApi: ${response.data.error}`);
  }

  const jobs = (response.data.jobs_results ?? [])
    .filter((job) => job.job_id && job.title)
    .map(normalize);

  return {
    jobs,
    nextPageToken: response.data.serpapi_pagination?.next_page_token ?? null,
  };
};
