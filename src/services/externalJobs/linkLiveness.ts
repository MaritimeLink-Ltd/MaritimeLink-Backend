import axios from 'axios';
import { politeGet, RobotsDisallowedError } from './politeFetcher.js';

/**
 * Whether a search listing's apply link still leads to an open vacancy.
 *
 * Only what the site lets us see: every request goes through politeGet
 * (identifying user-agent, robots.txt honoured). Measured on our own pool,
 * that verifies the employer sites and several boards (SmartRecruiters,
 * seaandbeyond, studysmarter, jobleads, bebee), but not LinkedIn or Indeed
 * (robots.txt disallows us) or Glassdoor, jooble and jobrapido (403 to
 * bots). Those come back 'unknown' and are left to the age limit
 * (expiry.ts) — never deleted on a guess.
 */

export type LinkStatus = 'live' | 'expired' | 'unknown';

/**
 * Wording a job page uses once the vacancy is gone. Deliberately narrow:
 * a match permanently deletes the listing, so it must not fire on a live
 * page. Checked against real pages from our own pool — live pages from
 * the boards we can verify matched none of these.
 */
const EXPIRED_WORDING = new RegExp(
  [
    'this (job|position|vacancy|posting|listing|role) (is )?no longer (available|open|active|accepting applications)',
    'this (job|position|vacancy|posting|listing|role) has (expired|been filled|been closed|closed|been removed)',
    'no longer accepting applications',
    '(job|vacancy|listing|posting) has expired',
    'position has been filled',
    'applications (are|have) (now )?closed',
    'job is no longer available',
  ].join('|'),
  'i',
);

/** The page's visible text — scripts, styles and markup removed. */
export const visibleText = (html: string): string =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ');

export const pageSaysExpired = (html: string): boolean =>
  EXPIRED_WORDING.test(visibleText(html));

const hostOf = (url: string): string | null => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
};

/**
 * Checks one link. `unreachableHosts` is shared across a run: once a host
 * refuses us (robots.txt, 401/403/429), the rest of its links are
 * 'unknown' without another request.
 */
export const checkLink = async (
  url: string,
  unreachableHosts: Set<string>,
): Promise<LinkStatus> => {
  const host = hostOf(url);
  if (!host || unreachableHosts.has(host)) return 'unknown';

  try {
    const html = await politeGet(
      url,
      undefined,
      'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
    );
    return pageSaysExpired(html) ? 'expired' : 'live';
  } catch (error) {
    if (error instanceof RobotsDisallowedError) {
      unreachableHosts.add(host);
      return 'unknown';
    }
    const status = axios.isAxiosError(error)
      ? error.response?.status
      : undefined;
    // The page itself is gone — the one HTTP answer that means "expired".
    if (status === 404 || status === 410) return 'expired';
    if (status === 401 || status === 403 || status === 429)
      unreachableHosts.add(host);
    return 'unknown';
  }
};
