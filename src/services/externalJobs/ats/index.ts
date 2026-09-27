import { env } from '../../../config/env.js';
import { scopeCompanyBoard } from '../scope.js';
import { ExternalJob } from '../types.js';
import { parseAtsConfig, parseWorkdaySites } from './config.js';
import { fetchGreenhouseJobs } from './greenhouse.js';
import { fetchLeverJobs } from './lever.js';
import { fetchPinpointJobs } from './pinpoint.js';
import { fetchRecruiteeJobs } from './recruitee.js';
import { fetchSmartRecruitersJobs } from './smartrecruiters.js';
import { fetchTeamtailorJobs } from './teamtailor.js';
import { fetchWorkdayJobs } from './workday.js';

/**
 * Company career-page sources via the hiring platforms those companies use —
 * a public, documented job feed per company rather than a bespoke scraper
 * of each company's own site.
 *
 * Every source here is re-read in full on every refresh (no rotation, no
 * metered quota — these are free public endpoints). refresh.ts prunes a
 * listing once a source that answered stops returning it (see prune.ts).
 *
 * Which companies: the client's 300-company list was checked against the
 * public job endpoints of ten platforms (Teamtailor, Workable, Pinpoint,
 * Recruitee, Personio, Greenhouse, Lever (both regions), SmartRecruiters,
 * Breezy). Of 22 accounts that answered, most were unrelated organisations
 * sharing the name (a UK social-work charity called Frontline, a Jersey
 * daycare, a legal-AI startup called Saga, Pinpoint demo data) or boards
 * with no seagoing roles (Anglo-Eastern's and DOF's Workable accounts are
 * office hiring). The ones configured are the genuine seagoing boards.
 */

/**
 * Standing "send us your CV" entries, not a specific vacancy — nothing for
 * a candidate to apply *to*. Seen live: Stena's "Seafarer Talent Pool
 * Registration" (dated 2025) and "Student Talent Pool Registration" (2024).
 */
const CATCH_ALL_TITLE =
  /\b(talent pool|general application|open application|spontaneous application|unsolicited application|employee referrals?)\b/i;

const isSpecificVacancy = (job: ExternalJob) =>
  !CATCH_ALL_TITLE.test(job.title);

/** Board-level filtering every source goes through exactly once. */
const scopeBoard = (jobs: ExternalJob[]) =>
  scopeCompanyBoard(jobs.filter(isSpecificVacancy));

const safely = async (
  label: string,
  run: () => Promise<ExternalJob[]>,
): Promise<ExternalJob[]> => {
  try {
    const jobs = await run();
    console.log(`[external-jobs] ATS ${label}: ${jobs.length} listing(s)`);
    return jobs;
  } catch (error) {
    console.error(
      `[external-jobs] ATS source failed (${label}):`,
      error instanceof Error ? error.message : error,
    );
    return [];
  }
};

export const fetchAtsJobs = async (): Promise<ExternalJob[]> => {
  const greenhouseBoards = parseAtsConfig(env.ATS_GREENHOUSE_BOARDS);
  const leverCompanies = parseAtsConfig(env.ATS_LEVER_COMPANIES);
  const smartRecruitersCompanies = parseAtsConfig(
    env.ATS_SMARTRECRUITERS_COMPANIES,
  );
  const workdaySites = parseWorkdaySites(env.ATS_WORKDAY_CAREER_SITES);
  const pinpointCompanies = parseAtsConfig(env.ATS_PINPOINT_COMPANIES);
  const teamtailorCompanies = parseAtsConfig(env.ATS_TEAMTAILOR_COMPANIES);
  const recruiteeCompanies = parseAtsConfig(env.ATS_RECRUITEE_COMPANIES);

  const results = await Promise.all([
    ...greenhouseBoards.map(({ id, label }) =>
      safely(`greenhouse:${id}`, async () =>
        scopeBoard(await fetchGreenhouseJobs(id, label)),
      ),
    ),
    ...leverCompanies.map(({ id, label }) =>
      safely(`lever:${id}`, async () =>
        scopeBoard(await fetchLeverJobs(id, label)),
      ),
    ),
    // Board filtering runs before the per-posting detail fetch here, so
    // postings that won't be kept never cost a request.
    ...smartRecruitersCompanies.map(({ id, label }) =>
      safely(`smartrecruiters:${id}`, () =>
        fetchSmartRecruitersJobs(id, label, scopeBoard),
      ),
    ),
    ...workdaySites.map(({ url, label }) =>
      safely(`workday:${label ?? url}`, async () =>
        scopeBoard(await fetchWorkdayJobs(url, label)),
      ),
    ),
    ...pinpointCompanies.map(({ id, label }) =>
      safely(`pinpoint:${id}`, async () =>
        scopeBoard(await fetchPinpointJobs(id, label)),
      ),
    ),
    ...teamtailorCompanies.map(({ id, label }) =>
      safely(`teamtailor:${id}`, async () =>
        scopeBoard(await fetchTeamtailorJobs(id, label)),
      ),
    ),
    ...recruiteeCompanies.map(({ id, label }) =>
      safely(`recruitee:${id}`, async () =>
        scopeBoard(await fetchRecruiteeJobs(id, label)),
      ),
    ),
  ]);

  return results.flat();
};

/** True once at least one ATS platform has a company/board configured. */
export const isAnyAtsSourceConfigured = (): boolean =>
  [
    env.ATS_GREENHOUSE_BOARDS,
    env.ATS_LEVER_COMPANIES,
    env.ATS_SMARTRECRUITERS_COMPANIES,
    env.ATS_WORKDAY_CAREER_SITES,
    env.ATS_PINPOINT_COMPANIES,
    env.ATS_TEAMTAILOR_COMPANIES,
    env.ATS_RECRUITEE_COMPANIES,
  ].some((value) => String(value ?? '').trim().length > 0);
