import { politeGet } from './politeFetcher.js';
import { toIsoDate } from './textUtils.js';

/**
 * Finds the posted date of a company-board job whose feed doesn't carry one,
 * from the job page itself.
 *
 * Pinpoint (V.Group) is the case this exists for: its postings.json has no
 * date at all, but every posting page embeds the schema.org JobPosting that
 * Google Jobs reads, with a real `datePosted` (confirmed live: a posting
 * the feed gave no date for carried "datePosted":"2025-05-13T02:50:19+01:00").
 * Without it, the 30-day limit (expiry.ts) could only go by when we first
 * saw a job, which says nothing about how long it's really been up.
 *
 * Only the first time: a found date is saved with the listing and reused
 * on later runs, and a job that turns out too old is remembered as expired
 * — so after the first run this costs one page read per NEW posting.
 */

/** The `datePosted` of the page's schema.org JobPosting, as ISO, or null. */
export const extractDatePosted = (html: string): string | null => {
  const match = html.match(/"datePosted"\s*:\s*"([^"]+)"/);
  return match ? toIsoDate(match[1]) : null;
};

/**
 * The job page's posted date, or null when the page can't be read (robots,
 * 403, timeout) or has no JobPosting date — never an invented one.
 */
export const findDatePosted = async (url: string): Promise<string | null> => {
  try {
    const html = await politeGet(
      url,
      undefined,
      'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
    );
    return extractDatePosted(html);
  } catch {
    return null;
  }
};
