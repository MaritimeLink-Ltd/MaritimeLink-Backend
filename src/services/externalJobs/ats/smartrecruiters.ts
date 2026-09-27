import { politeGet } from '../politeFetcher.js';
import { toIsoDate, toPlainText } from '../textUtils.js';
import { ExternalJob } from '../types.js';

/**
 * SmartRecruiters' public Posting API — no auth, documented at
 * dev.smartrecruiters.com/customer-api/posting-api/. `company` is the
 * identifier in a company's own SmartRecruiters URL
 * (careers.smartrecruiters.com/{company}). Confirmed live for Boskalis
 * (`boskalis`).
 *
 * The list endpoint carries no description, so each kept posting costs one
 * detail request — which also returns the canonical public `postingUrl`.
 * `keep` runs on the list-level fields first (see fetchAtsJobs's
 * corporate-board rule): measured on Boskalis, 106 listed postings narrow to
 * ~21 before any detail is fetched, rather than 106 detail requests a day.
 *
 * NOT currently usable: api.smartrecruiters.com's robots.txt allows only
 * LinkedInBot and disallows every other crawler (`User-agent: * /
 * Disallow: /`), and politeFetcher honours it — so a configured company
 * fails with RobotsDisallowedError rather than being fetched. Confirmed
 * live for Boskalis. Kept for if that policy changes; leave
 * ATS_SMARTRECRUITERS_COMPANIES unset until then.
 */

type SmartRecruitersPosting = {
  id: string;
  name: string;
  releasedDate?: string;
  location?: { city?: string; region?: string; country?: string };
  department?: { label?: string };
  function?: { label?: string };
  typeOfEmployment?: { label?: string };
};

type SmartRecruitersResponse = { content?: SmartRecruitersPosting[] };

type SmartRecruitersDetail = {
  postingUrl?: string;
  jobAd?: {
    sections?: Record<string, { text?: string } | undefined>;
  };
};

const PAGE_SIZE = 100;
/** Bounds one company's total request count regardless of how many roles it has open. */
const MAX_PAGES = 5;

/**
 * The job-specific sections only — `companyDescription` is left out on
 * purpose: it's the same boilerplate on every posting ("a global leader in
 * dredging and offshore..."), which would give every office role a
 * maritime-sounding description.
 */
const DESCRIPTION_SECTIONS = [
  'jobDescription',
  'qualifications',
  'additionalInformation',
];

const listPostings = async (
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
    const postings = (JSON.parse(raw) as SmartRecruitersResponse).content ?? [];

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
        applyLink: null,
        via: 'SmartRecruiters',
        thumbnail: null,
        category: posting.department?.label ?? posting.function?.label ?? null,
        employmentType: posting.typeOfEmployment?.label ?? null,
        source: 'external' as const,
        provider: 'smartrecruiters' as const,
      })),
    );

    if (postings.length < PAGE_SIZE) break;
  }

  return collected;
};

const postingIdOf = (job: ExternalJob) => job.id.split(':').slice(2).join(':');

export const fetchSmartRecruitersJobs = async (
  company: string,
  label?: string,
  keep: (jobs: ExternalJob[]) => ExternalJob[] = (jobs) => jobs,
): Promise<ExternalJob[]> => {
  const kept = keep(await listPostings(company, label));

  const detailed: ExternalJob[] = [];
  for (const job of kept) {
    try {
      const raw = await politeGet(
        `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(company)}/postings/${encodeURIComponent(postingIdOf(job))}`,
        undefined,
        'application/json',
      );
      const detail = JSON.parse(raw) as SmartRecruitersDetail;
      const sections = detail.jobAd?.sections ?? {};
      const description = toPlainText(
        DESCRIPTION_SECTIONS.map((key) => sections[key]?.text)
          .filter(Boolean)
          .join('\n'),
      );
      // No public page or no description to show — drop rather than list
      // something a candidate can't read or act on (same rule as Workday).
      if (!detail.postingUrl || !description) continue;
      detailed.push({ ...job, description, applyLink: detail.postingUrl });
    } catch {
      // A failed detail fetch drops just this posting; the rest still land.
    }
  }

  return detailed;
};
