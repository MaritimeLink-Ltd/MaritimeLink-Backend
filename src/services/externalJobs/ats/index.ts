import { env } from '../../../config/env.js';
import { ExternalJob } from '../types.js';
import { parseAtsConfig, parseWorkdaySites } from './config.js';
import { fetchGreenhouseJobs } from './greenhouse.js';
import { fetchLeverJobs } from './lever.js';
import { fetchSmartRecruitersJobs } from './smartrecruiters.js';
import { fetchWorkdayJobs } from './workday.js';

/**
 * Company career-page sources via common ATS platforms — the "many companies
 * use Greenhouse/Lever/Workday/SmartRecruiters" integrations, as opposed to a
 * bespoke scraper per company's own custom site.
 *
 * Every platform here is queried in full on every refresh (no rotation, no
 * metered quota — these are free public endpoints), the same way
 * feedSource.ts re-reads its RSS feeds in full each day. refresh.ts prunes a
 * listing once a full re-fetch stops returning it, same reasoning as feeds.
 *
 * iCIMS (the fifth platform named to the client) has no comparably
 * standardized public JSON API across tenants — where a company's iCIMS
 * portal exposes an RSS export, EXTERNAL_JOB_FEEDS (feedSource.ts) already
 * covers it with zero extra code; otherwise it falls into the same
 * per-company custom-scraper bucket already scoped to the client.
 */

const safely = async (
  label: string,
  run: () => Promise<ExternalJob[]>,
): Promise<ExternalJob[]> => {
  try {
    return await run();
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

  const results = await Promise.all([
    ...greenhouseBoards.map(({ id, label }) =>
      safely(`greenhouse:${id}`, () => fetchGreenhouseJobs(id, label)),
    ),
    ...leverCompanies.map(({ id, label }) =>
      safely(`lever:${id}`, () => fetchLeverJobs(id, label)),
    ),
    ...smartRecruitersCompanies.map(({ id, label }) =>
      safely(`smartrecruiters:${id}`, () =>
        fetchSmartRecruitersJobs(id, label),
      ),
    ),
    ...workdaySites.map(({ url, label }) =>
      safely(`workday:${url}`, () => fetchWorkdayJobs(url, label)),
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
  ].some((value) => String(value ?? '').trim().length > 0);
