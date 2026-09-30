/**
 * Which of a search result's apply links to give a professional.
 *
 * Google Jobs (and JSearch) list the same vacancy on several sites. The
 * first one is often a re-posting site that copies listings and keeps them
 * up long after the employer has closed them. Measured live on 20 random
 * links per site from our own pool (browser check, verifiable pages only):
 *   bebee.com            95% expired  (441 listings — the biggest link host)
 *   jobrapido            33-66% expired
 *   jobleads.com         40% expired
 *   linkedin             15-28% expired
 *   smartrecruiters, seaandbeyond, findseajobs, jobs.mhariri  0% expired
 * So: never take a link from a site on EXPIRY_PRONE_HOSTS, and prefer the
 * employer's own careers page over any job board when both are offered.
 */

/**
 * Re-posting sites that are both mostly expired AND can't be checked link
 * by link: bebee shows bots a different page than browsers (the checker
 * saw 5 of 15 expired where a browser saw 95%), and jobrapido refuses bots
 * outright (403). jobleads, at 40% expired, is deliberately NOT here: the
 * link checker reads it reliably (caught 10 of 12), so its live ~60% are
 * kept and its dead links removed one by one (linkLiveness.ts).
 */
export const EXPIRY_PRONE_HOSTS = ['bebee.com', 'jobrapido.com'];

/**
 * Sites whose job pages the link checker isn't allowed to read — measured
 * with the production fetcher: LinkedIn and Indeed disallow us in
 * robots.txt; Glassdoor, jooble, poeajobs, jobatsea and SimplyHired return
 * 403 to bots. A link here can never be confirmed live or dead, so another
 * site's link for the same vacancy is preferred whenever one is offered
 * (and an undated vacancy only listed here isn't kept — see expiry.ts).
 */
export const UNCHECKABLE_HOSTS = [
  'linkedin.com',
  'indeed.com',
  'glassdoor.com',
  'glassdoor.co.uk',
  'glassdoor.co.in',
  'jooble.org',
  'poeajobs.ph',
  'jobatsea.online',
  'simplyhired.com',
  'simplyhired.co.uk',
  'simplyhired.co.in',
  'totaljobs.com',
];

/**
 * Job boards and aggregators — fine to link to, but a vacancy's own
 * careers page (anything not on this list) is the canonical source and is
 * taken down when the job closes, so it's preferred when offered.
 */
const JOB_BOARD_HOSTS = [
  'linkedin.com',
  'indeed.com',
  'glassdoor.com',
  'glassdoor.co.uk',
  'glassdoor.co.in',
  'simplyhired.com',
  'simplyhired.co.uk',
  'simplyhired.co.in',
  'jooble.org',
  'adzuna.com',
  'adzuna.co.uk',
  'adzuna.in',
  'foundit.in',
  'naukri.com',
  'shine.com',
  'bayt.com',
  'totaljobs.com',
  'reed.co.uk',
  'cv-library.co.uk',
  'monster.com',
  'ziprecruiter.com',
  'talent.com',
  'levels.fyi',
  'kitjob.in',
  'jobstreet.com',
  'myjobmag.com',
  'careerjet.com',
];

/** True when `hostname` is `domain` itself or any subdomain of it (uk.indeed.com, ph.jobrapido.com). */
const isOnDomain = (hostname: string, domain: string) =>
  hostname === domain || hostname.endsWith(`.${domain}`);

const hostOf = (url: string): string | null => {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
};

export const isExpiryProneLink = (url: string): boolean => {
  const host = hostOf(url);
  return host !== null && EXPIRY_PRONE_HOSTS.some((d) => isOnDomain(host, d));
};

const isJobBoardLink = (url: string): boolean => {
  const host = hostOf(url);
  return host !== null && JOB_BOARD_HOSTS.some((d) => isOnDomain(host, d));
};

export const isUncheckableLink = (url: string): boolean => {
  const host = hostOf(url);
  return host !== null && UNCHECKABLE_HOSTS.some((d) => isOnDomain(host, d));
};

/**
 * The best apply link from a result's options, or null when every option
 * is on an expiry-prone re-posting site — such a vacancy shouldn't be
 * listed at all. Order: the employer's own page, then a board the link
 * checker can read, then one it can't — keeping the provider's order
 * within each tier.
 */
export const pickApplyLink = (
  links: (string | null | undefined)[],
): string | null => {
  const usable = links.filter(
    (link): link is string =>
      typeof link === 'string' &&
      hostOf(link) !== null &&
      !isExpiryProneLink(link),
  );
  const employer = usable.find(
    (link) => !isJobBoardLink(link) && !isUncheckableLink(link),
  );
  const checkableBoard = usable.find((link) => !isUncheckableLink(link));
  return employer ?? checkableBoard ?? usable[0] ?? null;
};
