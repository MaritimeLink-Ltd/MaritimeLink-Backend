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
 * The lower band is the wider maritime market, so this is generous. Payload
 * stays small — listings are text and the UI renders a simple list.
 */
const MAX_RESULTS = 120;

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
  applyLink: row.applyLink,
  via: row.via,
  thumbnail: row.thumbnail,
  category: row.category,
  employmentType: row.employmentType,
  source: 'external',
  provider: row.provider === 'feed' ? 'feed' : 'serpapi',
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

/** Newest first; listings with no date sink below dated ones. */
const byRecency = (a: ExternalJob, b: ExternalJob) => {
  const time = (job: ExternalJob) => {
    if (!job.postedAt) return 0;
    const parsed = Date.parse(job.postedAt);
    return Number.isNaN(parsed) ? 0 : parsed;
  };
  return time(b) - time(a);
};

export type ExternalJobsResult = {
  /** Matched jobs first (best score first), then the rest (newest first). */
  jobs: ExternalJob[];
  /** How many leading entries of `jobs` are profile matches. */
  matchedCount: number;
  /** False when the profile was too sparse to rank on. */
  personalized: boolean;
};

/**
 * Returns external maritime jobs for a professional in two bands: the ones
 * matching their profile, then the wider maritime market. Nothing in the pool
 * is discarded — a low score demotes a job rather than hiding it.
 */
export const getExternalJobsForProfessional = async (
  professional: ProfessionalWithResume,
): Promise<ExternalJobsResult> => {
  const rows = await prisma.externalJobListing.findMany();
  const pool = rows.map(toExternalJob);

  if (!hasMatchableProfile(professional)) {
    return {
      jobs: [...pool].sort(byRecency).slice(0, MAX_RESULTS),
      matchedCount: 0,
      personalized: false,
    };
  }

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

  const matched = scored
    .filter((job) => job.matched)
    .sort((a, b) => (b.matchScore ?? 0) - (a.matchScore ?? 0));

  const others = scored.filter((job) => !job.matched).sort(byRecency);

  return {
    jobs: [...matched, ...others].slice(0, MAX_RESULTS),
    matchedCount: Math.min(matched.length, MAX_RESULTS),
    personalized: matched.length > 0,
  };
};

export type { ExternalJob } from './types.js';
export { professionalMatchInclude } from './profileQuery.js';
