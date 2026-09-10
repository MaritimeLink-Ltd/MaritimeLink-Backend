import { politeGet, politePost } from '../politeFetcher.js';
import { toIsoDate, toPlainText } from '../textUtils.js';
import { ExternalJob } from '../types.js';

/**
 * Workday's CXS (careers experience) API — the same JSON endpoint a
 * Workday-hosted careers page itself calls to render its job list. No public
 * docs and no auth; the request shape below is the widely-observed contract
 * (used by most third-party job aggregators), not something Workday commits
 * to keeping stable — if a tenant's response stops parsing, that tenant's
 * `baseUrl` is the first thing to re-verify against its live careers site.
 *
 * Unlike Greenhouse/Lever/SmartRecruiters, there's no shared subdomain or
 * short slug to build the URL from: each tenant's data-center number
 * (`wd1`, `wd3`, `wd5`, ...) and site path (`External`, `Careers`, ...) is
 * only knowable by opening that company's careers page — see
 * `WorkdaySiteConfig` in config.ts.
 */

type WorkdayJobPosting = {
  title: string;
  externalPath: string;
  locationsText?: string;
};

type WorkdaySearchResponse = { jobPostings?: WorkdayJobPosting[] };

type WorkdayJobDetail = {
  title?: string;
  jobDescription?: string;
  location?: string;
  /** The real, working public job page — see the comment on `fetchWorkdayJobs` below. */
  externalUrl?: string;
  /**
   * Despite the name, this is the posting's publish date, not an employment
   * start date — confirmed live against Svitzer: a posting whose list-view
   * `postedOn` read "Posted 2 Days Ago" carried `startDate: "2026-09-08"`
   * (2 days before that check), and one reading "Posted 30+ Days Ago"
   * carried a `startDate` over 60 days back. The list endpoint only exposes
   * that relative text, not this real date — another reason the per-job
   * detail fetch (see `fetchJobDetail`) is unavoidable.
   */
  startDate?: string;
};

type WorkdayJobDetailResponse = { jobPostingInfo?: WorkdayJobDetail };

const PAGE_SIZE = 20;
/** Bounds one tenant's total request count regardless of how many roles it has open. */
const MAX_PAGES = 5;

/**
 * The list endpoint's `externalPath` is not a complete public URL on its
 * own — measured live against Svitzer: `${origin}${externalPath}` 404s as
 * "invalid URL", because Workday's real job page needs a locale/site path
 * segment (e.g. `/en-US/Svitzer_Careers/job/...`) that the list response
 * never includes. The per-job detail endpoint hands back the exact,
 * already-correct `externalUrl` alongside the full description — the list
 * endpoint has neither, so this is the only reliable source for both.
 */
const fetchJobDetail = async (
  cxsBase: string,
  externalPath: string,
): Promise<WorkdayJobDetail | null> => {
  try {
    const raw = await politeGet(
      `${cxsBase}${externalPath}`,
      undefined,
      'application/json',
    );
    const parsed = JSON.parse(raw) as WorkdayJobDetailResponse;
    return parsed.jobPostingInfo ?? null;
  } catch {
    return null;
  }
};

export const fetchWorkdayJobs = async (
  baseUrl: string,
  label?: string,
): Promise<ExternalJob[]> => {
  const cxsBase = baseUrl.replace(/\/$/, '');
  const companyLabel = label ?? new URL(baseUrl).hostname.split('.')[0];

  const postings: WorkdayJobPosting[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const raw = await politePost(`${cxsBase}/jobs`, {
      appliedFacets: {},
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
      searchText: '',
    });
    const parsed = JSON.parse(raw) as WorkdaySearchResponse;
    const pagePostings = parsed.jobPostings ?? [];
    postings.push(...pagePostings);

    if (pagePostings.length < PAGE_SIZE) break;
  }

  const jobs: ExternalJob[] = [];
  for (const posting of postings) {
    const detail = await fetchJobDetail(cxsBase, posting.externalPath);
    // No working apply link or description to show without it — drop
    // rather than list something a candidate can't actually act on.
    if (!detail?.externalUrl) continue;

    jobs.push({
      id: `workday:${companyLabel}:${posting.externalPath}`,
      title: detail.title ?? posting.title,
      company: companyLabel,
      location: detail.location ?? posting.locationsText ?? null,
      description: toPlainText(detail.jobDescription ?? ''),
      salary: null,
      postedAt: toIsoDate(detail.startDate),
      applyLink: detail.externalUrl,
      via: 'Workday',
      thumbnail: null,
      category: null,
      employmentType: null,
      source: 'external',
      provider: 'workday',
    });
  }

  return jobs;
};
