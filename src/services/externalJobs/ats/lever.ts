import axios from 'axios';
import { politeGet } from '../politeFetcher.js';
import { toIsoDate, toPlainText } from '../textUtils.js';
import { ExternalJob } from '../types.js';

/**
 * Lever's public postings API — no auth, documented at
 * github.com/lever/postings-api. `company` is the slug in a company's own
 * Lever URL (jobs.lever.co/{company} or jobs.eu.lever.co/{company}).
 *
 * Lever runs two independent regional clusters with the same API shape —
 * `api.lever.co` (US) and `api.eu.lever.co` (EU) — and a company's postings
 * only exist on whichever one they signed up on. There's no way to tell
 * which from the slug alone (confirmed live: Columbia Shipmanagement's
 * `csmcy` 404s on the US cluster and only resolves on the EU one), so both
 * are tried in order and the first to answer wins.
 */

type LeverPosting = {
  id: string;
  text: string;
  hostedUrl?: string;
  applyUrl?: string;
  createdAt?: number;
  descriptionPlain?: string;
  description?: string;
  categories?: { location?: string; team?: string; commitment?: string };
};

const LEVER_CLUSTERS = ['https://api.lever.co', 'https://api.eu.lever.co'];

const fetchFromCluster = async (
  clusterBase: string,
  company: string,
): Promise<LeverPosting[]> => {
  const raw = await politeGet(
    `${clusterBase}/v0/postings/${encodeURIComponent(company)}`,
    { mode: 'json' },
    'application/json',
  );
  return JSON.parse(raw) as LeverPosting[];
};

/** True for the "wrong cluster" 404 Lever returns for an unknown company slug on that cluster. */
const isUnknownCompany = (error: unknown): boolean =>
  axios.isAxiosError(error) && error.response?.status === 404;

/**
 * Not a real, specific opening — a standing "submit your CV for anything"
 * catch-all some crewing companies keep open indefinitely (confirmed live:
 * Columbia Shipmanagement runs 8 of these, one per office, the oldest dated
 * 2022 — see the `postedAt` comment below for why that date isn't shown).
 * There's nothing for a candidate to apply *to* here, so it doesn't belong
 * in a job feed.
 */
const isGenericCatchAll = (posting: LeverPosting): boolean =>
  posting.categories?.team === 'Unsolicited Jobs' ||
  /^general application$/i.test(posting.text.trim());

export const fetchLeverJobs = async (
  company: string,
  label?: string,
): Promise<ExternalJob[]> => {
  let postings: LeverPosting[] | undefined;

  for (const [index, clusterBase] of LEVER_CLUSTERS.entries()) {
    try {
      postings = await fetchFromCluster(clusterBase, company);
      break;
    } catch (error) {
      const isLastCluster = index === LEVER_CLUSTERS.length - 1;
      if (isLastCluster || !isUnknownCompany(error)) throw error;
    }
  }

  return (postings ?? [])
    .filter((posting) => !isGenericCatchAll(posting))
    .map((posting) => ({
      id: `lever:${company}:${posting.id}`,
      title: posting.text,
      company: label ?? company,
      location: posting.categories?.location ?? null,
      description: toPlainText(
        posting.descriptionPlain ?? posting.description ?? '',
      ),
      salary: null,
      // Lever's `createdAt` is when the requisition was first opened, which
      // for a crewing company that keeps a rank's requisition open
      // indefinitely across crew rotations can be genuinely old (measured
      // live: 35 of Columbia Shipmanagement's 216 postings predate 2026) —
      // but that's a real, honest signal once the generic catch-alls above
      // are excluded: an old requisition should rank low in a newest-first
      // list, not be hidden or masquerade as fresh. Using it (instead of
      // leaving it null, which falls back to today's fetchedAt on every
      // refresh and would rank *every* Lever posting as "posted today"
      // forever) is what makes "newest first" mean anything once merged
      // with SerpApi/JSearch listings that carry real dates too.
      postedAt: toIsoDate(posting.createdAt),
      applyLink: posting.applyUrl ?? posting.hostedUrl ?? null,
      via: 'Lever',
      thumbnail: null,
      category: posting.categories?.team ?? null,
      employmentType: posting.categories?.commitment ?? null,
      source: 'external',
      provider: 'lever',
    }));
};
