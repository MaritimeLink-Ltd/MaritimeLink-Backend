import { prisma } from '../../config/prisma.js';
import { scoreProfessionalForJob } from '../../utils/jobMatching.js';
import { hasMatchableProfile, ProfessionalWithResume } from './profileQuery.js';
import { ExternalJob } from './types.js';

/**
 * Ranks the daily-refreshed external job pool for one professional.
 *
 * This module never calls SerpApi or the job feeds — that only happens once a
 * day, in refresh.ts, run by a scheduled job (see
 * scripts/refresh-external-jobs.ts). A user request here is a DB read plus
 * in-process scoring, so it's fast and never waits on a third party.
 */

/** Below this, a listing is unrelated enough to hide from a matched feed. */
const MIN_MATCH_SCORE = 16;

/**
 * Real pagination, not a fixed cutoff: the pool crossed 500+ rows once
 * 12-country coverage started working, and the old approach (sort, then
 * slice the top 120/200 and discard the rest) meant a whole country's worth
 * of real, genuine listings could sit in the database and never be
 * reachable by any professional, simply because higher-volume markets
 * (UK/India/Philippines-scale) filled every visible slot first. Nothing is
 * discarded now — every listing is on some page, always newest-first.
 */
export const DEFAULT_PAGE_SIZE = 50;
/** Upper bound on `limit`, so a client can't ask for the entire table in one call. */
export const MAX_PAGE_SIZE = 100;

const toExternalJob = (
  row: Awaited<ReturnType<typeof prisma.externalJobListing.findMany>>[number],
): ExternalJob => ({
  id: row.id,
  title: row.title,
  company: row.company,
  location: row.location,
  description: row.description,
  salary: row.salary,
  postedAt: row.postedAt,
  fetchedAt: row.fetchedAt.toISOString(),
  applyLink: row.applyLink,
  via: row.via,
  thumbnail: row.thumbnail,
  category: row.category,
  employmentType: row.employmentType,
  source: 'external',
  provider:
    row.provider === 'feed' || row.provider === 'jsearch'
      ? row.provider
      : 'serpapi',
});

/**
 * `scoreProfessionalForJob` reads rank and category off the resume, but many
 * professionals carry them on the Professional record instead. Fold those in so
 * an "Able Seaman" is matched on their rank whichever field holds it.
 */
const toMatchableProfessional = (professional: ProfessionalWithResume) => ({
  ...professional,
  resume: {
    ...professional.resume,
    subcategory: professional.resume?.subcategory || professional.subcategory,
    category: professional.resume?.category || professional.profession,
    skills: professional.resume?.skills ?? [],
    seaService: professional.resume?.seaService ?? [],
  },
});

/**
 * Part of the score that depends on the candidate, not the job — the verified
 * and status bonuses. Scoring against an empty job isolates it so thresholds
 * measure job relevance rather than account standing.
 */
const candidateBaselineScore = (
  matchable: ReturnType<typeof toMatchableProfessional>,
) =>
  scoreProfessionalForJob(
    { title: '', description: '', location: '', category: '' },
    matchable,
  ).score;

/**
 * Falls back to `fetchedAt` when a listing has no `postedAt` — genuinely
 * common for smaller markets (Kenya/South Africa/Egypt routinely come back
 * with no date at all from Google Jobs), and NOT a signal the listing is
 * old. Treating a missing date as epoch (the previous behaviour) buried
 * every undated listing beneath every dated one, permanently, regardless of
 * how recently it was actually confirmed live.
 */
const postedAtMs = (job: ExternalJob): number => {
  if (job.postedAt) {
    const parsed = Date.parse(job.postedAt);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return (job.fetchedAt && Date.parse(job.fetchedAt)) || 0;
};

/** Newest first; a listing with no usable date at all sinks to the bottom. */
const byRecency = (a: ExternalJob, b: ExternalJob) =>
  postedAtMs(b) - postedAtMs(a);

export type ExternalJobsPagination = {
  /** 1-indexed. Defaults to 1. */
  page?: number;
  /** Defaults to DEFAULT_PAGE_SIZE, clamped to MAX_PAGE_SIZE. */
  limit?: number;
};

const clampPagination = ({ page, limit }: ExternalJobsPagination) => ({
  page: Math.max(1, Math.floor(page ?? 1)),
  limit: Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Math.floor(limit ?? DEFAULT_PAGE_SIZE)),
  ),
});

export type ExternalJobsResult = {
  /** Just this page — matched-band jobs first, newest first within each band. */
  jobs: ExternalJob[];
  /** Total matches across the WHOLE pool, not just this page. */
  matchedCount: number;
  /** False when the profile was too sparse to rank on. */
  personalized: boolean;
  /** Total jobs across every page (matched + wider market combined). */
  total: number;
  page: number;
  limit: number;
  /** Always >= 1, even when `total` is 0. */
  pages: number;
};

/**
 * Returns one page of external maritime jobs for a professional, ranked in
 * two bands: the ones matching their profile, then the wider maritime
 * market — newest first within each band, and newest-first across the whole
 * wider-market band regardless of which country a listing is from. Nothing
 * in the pool is ever discarded: a low score, or simply being older, only
 * pushes a listing to a later page, never off the list entirely. The row
 * itself leaves the platform only once it ages past refresh.ts's retention
 * window or an admin removes it — see hiddenByAdmin above.
 */
export const getExternalJobsForProfessional = async (
  professional: ProfessionalWithResume,
  pagination: ExternalJobsPagination = {},
): Promise<ExternalJobsResult> => {
  const { page, limit } = clampPagination(pagination);
  const skip = (page - 1) * limit;

  const rows = await prisma.externalJobListing.findMany({
    where: { hiddenByAdmin: false },
  });
  const pool = rows.map(toExternalJob);

  let combined: ExternalJob[];
  let matchedCount = 0;
  let personalized = false;

  if (!hasMatchableProfile(professional)) {
    combined = [...pool].sort(byRecency);
  } else {
    const matchable = toMatchableProfessional(professional);
    const baseline = candidateBaselineScore(matchable);

    const scored = pool.map((job) => {
      const { score, criteria } = scoreProfessionalForJob(
        {
          title: job.title,
          description: job.description,
          location: job.location,
          category: job.category,
        },
        matchable,
      );
      // Relevance to this job only, with the candidate-quality bonus removed.
      const relevance = Math.max(0, score - baseline);
      return {
        ...job,
        matchScore: relevance,
        matchReasons: criteria,
        matched: relevance >= MIN_MATCH_SCORE,
      };
    });

    // matchScore only decides band membership — ordering within a band is
    // always by recency, newest first. An older job never outranks a
    // fresher one just for scoring higher.
    const matched = scored.filter((job) => job.matched).sort(byRecency);
    const others = scored.filter((job) => !job.matched).sort(byRecency);

    combined = [...matched, ...others];
    matchedCount = matched.length;
    personalized = matched.length > 0;
  }

  const total = combined.length;

  return {
    jobs: combined.slice(skip, skip + limit),
    matchedCount,
    personalized,
    total,
    page,
    limit,
    pages: Math.max(1, Math.ceil(total / limit)),
  };
};

export type { ExternalJob } from './types.js';
export { professionalMatchInclude } from './profileQuery.js';
