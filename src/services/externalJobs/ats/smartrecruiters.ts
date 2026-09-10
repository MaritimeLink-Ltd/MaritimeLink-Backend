import { politeGet } from '../politeFetcher.js';
import { toIsoDate } from '../textUtils.js';
import { ExternalJob } from '../types.js';

/**
 * SmartRecruiters' public Posting API — no auth, documented at
 * dev.smartrecruiters.com/customer-api/posting-api/. `company` is the
 * identifier in a company's own SmartRecruiters URL
 * (careers.smartrecruiters.com/{company}).
 *
 * The list endpoint doesn't carry a full description (that's a second,
 * per-job request on this API) — deliberately not fetched here so one
 * company with hundreds of postings doesn't turn into hundreds of extra
 * requests per refresh. Title/department/location are enough for scope.ts's
 * maritime-signal check to work the same way it already does for
 * SerpApi/JSearch listings with a thin description.
 */

type SmartRecruitersPosting = {
  id: string;
  name: string;
  releasedDate?: string;
  location?: { city?: string; region?: string; country?: string };
  department?: { label?: string };
  function?: { label?: string };
  postingUrl?: string;
  applyUrl?: string;
};

type SmartRecruitersResponse = { content?: SmartRecruitersPosting[] };

const PAGE_SIZE = 100;
/** Bounds one company's total request count regardless of how many roles it has open. */
const MAX_PAGES = 5;

export const fetchSmartRecruitersJobs = async (
  company: string,
  label?: string,
): Promise<ExternalJob[]> => {
  const collected: ExternalJob[] = [];

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const raw = await politeGet(
      `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(company)}/postings`,
      { limit: PAGE_SIZE, offset: page * PAGE_SIZE },
      'application/json',
    );
    const parsed = JSON.parse(raw) as SmartRecruitersResponse;
    const postings = parsed.content ?? [];

    collected.push(
      ...postings.map((posting) => ({
        id: `smartrecruiters:${company}:${posting.id}`,
        title: posting.name,
        company: label ?? company,
        location:
          [
            posting.location?.city,
            posting.location?.region,
            posting.location?.country,
          ]
            .filter(Boolean)
            .join(', ') || null,
        description: '',
        salary: null,
        postedAt: toIsoDate(posting.releasedDate),
        applyLink:
          posting.applyUrl ??
          posting.postingUrl ??
          `https://jobs.smartrecruiters.com/${company}/${posting.id}`,
        via: 'SmartRecruiters',
        thumbnail: null,
        category: posting.department?.label ?? posting.function?.label ?? null,
        employmentType: null,
        source: 'external' as const,
        provider: 'smartrecruiters' as const,
      })),
    );

    if (postings.length < PAGE_SIZE) break;
  }

  return collected;
};
