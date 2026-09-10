/**
 * Config parsing shared by the ATS sources (greenhouse.ts, lever.ts,
 * smartrecruiters.ts, workday.ts).
 *
 * No source here ships with default companies — same reasoning as
 * feedSource.ts's DEFAULT_FEEDS: MaritimeLink doesn't yet have the client's
 * list of company boards, so every list below is empty until the matching
 * env var is set (one comma-separated list per platform).
 */

/** One configured company/board to pull listings from on a given ATS. */
export type AtsCompanyConfig = {
  /** Board token / company slug, exactly as that platform's API expects it. */
  id: string;
  /** Display company name, when the raw id/slug isn't presentable on its own. */
  label?: string;
};

/**
 * Parses a comma-separated env value of `id` or `id:Display Name` entries —
 * used by the three platforms (Greenhouse, Lever, SmartRecruiters) whose
 * public API only needs a short token, unlike Workday (see
 * `parseWorkdaySites` below).
 */
export const parseAtsConfig = (value: string | undefined): AtsCompanyConfig[] =>
  String(value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const separator = entry.indexOf(':');
      if (separator === -1) return { id: entry };
      const id = entry.slice(0, separator).trim();
      const label = entry.slice(separator + 1).trim();
      return { id, label: label || undefined };
    });

/** One configured Workday tenant career site. */
export type WorkdaySiteConfig = {
  /**
   * The tenant's CXS API base URL, e.g.
   * `https://acmeshipping.wd1.myworkdayjobs.com/wday/cxs/acmeshipping/External`
   * — copied verbatim from the company's careers site (browser network tab
   * while its job list loads). The data-center number (`wd1`, `wd3`, `wd5`,
   * ...) and the site path (`External`, `Careers`, ...) are tenant-specific
   * and can't be derived from the company name alone.
   */
  url: string;
  label?: string;
};

/**
 * Parses `ATS_WORKDAY_CAREER_SITES`: comma-separated entries of `url` or
 * `url|Display Name`. Pipe-separated (not colon, unlike `parseAtsConfig`)
 * because the URL itself contains colons (`https://`).
 */
export const parseWorkdaySites = (
  value: string | undefined,
): WorkdaySiteConfig[] =>
  String(value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const separator = entry.indexOf('|');
      if (separator === -1) return { url: entry };
      const url = entry.slice(0, separator).trim();
      const label = entry.slice(separator + 1).trim();
      return { url, label: label || undefined };
    });
