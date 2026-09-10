import axios from 'axios';

/**
 * Shared outbound HTTP for the external-jobs crawlers.
 *
 * Third-party job boards are someone else's infrastructure, so every request
 * made here is throttled per host, identifies itself, and honours robots.txt.
 * Sources call `politeGet` rather than axios directly so those guarantees hold
 * everywhere.
 */

const USER_AGENT =
  'MaritimeLinkBot/1.0 (+https://maritimelink.co; job aggregation)';

/** Minimum gap between two requests to the same host. */
const MIN_HOST_INTERVAL_MS = 1500;

/**
 * A large ATS board's full-content response can genuinely be a few MB (a
 * company with 200+ postings each carrying an HTML description) — measured
 * live against Columbia Shipmanagement's Lever board (216 postings, ~2.6MB):
 * 3-5.5s over several runs, but occasionally close enough to the previous
 * 15s ceiling on a slow connection to time out outright. 30s keeps real
 * margin above that without meaningfully slowing down the common case
 * (a feed or a small ATS board), since this is only an upper bound.
 */
const REQUEST_TIMEOUT_MS = 30000;

/** Refuse to buffer more than this from any single response. */
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

const ROBOTS_TTL_MS = 24 * 60 * 60 * 1000;

/** Tail of the last request per host, so same-host fetches queue up. */
const hostQueues = new Map<string, Promise<unknown>>();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Serializes work per host and spaces each run by MIN_HOST_INTERVAL_MS. */
const enqueueForHost = <T>(
  host: string,
  task: () => Promise<T>,
): Promise<T> => {
  const previous = hostQueues.get(host) ?? Promise.resolve();
  const run = previous
    .catch(() => undefined)
    .then(async () => {
      const result = await task();
      await sleep(MIN_HOST_INTERVAL_MS);
      return result;
    });

  // Keep the chain alive for ordering but swallow rejections so one failure
  // doesn't poison later requests to the same host.
  hostQueues.set(
    host,
    run.catch(() => undefined),
  );
  return run;
};

type RobotsRules = { disallow: string[]; allow: string[] };

const robotsCache = new Map<
  string,
  { rules: RobotsRules; fetchedAt: number }
>();

/**
 * Parses the `User-agent: *` group of a robots.txt body. Wildcard-specific
 * groups are what a generic aggregator must obey; we intentionally ignore
 * groups targeted at named crawlers.
 */
const parseRobots = (body: string): RobotsRules => {
  const rules: RobotsRules = { disallow: [], allow: [] };
  let inStarGroup = false;

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.split('#')[0].trim();
    if (!line) continue;

    const separator = line.indexOf(':');
    if (separator === -1) continue;

    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (field === 'user-agent') {
      inStarGroup = value === '*';
      continue;
    }
    if (!inStarGroup) continue;
    if (field === 'disallow' && value) rules.disallow.push(value);
    if (field === 'allow' && value) rules.allow.push(value);
  }

  return rules;
};

const fetchRobots = async (origin: string): Promise<RobotsRules> => {
  const cached = robotsCache.get(origin);
  if (cached && Date.now() - cached.fetchedAt < ROBOTS_TTL_MS) {
    return cached.rules;
  }

  let rules: RobotsRules = { disallow: [], allow: [] };
  try {
    const response = await axios.get<string>(`${origin}/robots.txt`, {
      timeout: REQUEST_TIMEOUT_MS,
      responseType: 'text',
      maxContentLength: 512 * 1024,
      headers: { 'User-Agent': USER_AGENT },
      // 4xx simply means "no robots.txt to honour".
      validateStatus: (status) => status < 500,
    });
    if (typeof response.data === 'string' && response.status < 400) {
      rules = parseRobots(response.data);
    }
  } catch {
    // Unreachable robots.txt is treated as "no stated restrictions", matching
    // common crawler behaviour for a site that simply doesn't publish one.
    rules = { disallow: [], allow: [] };
  }

  robotsCache.set(origin, { rules, fetchedAt: Date.now() });
  return rules;
};

/** Longest matching rule wins; an equally specific Allow beats Disallow. */
const isPathAllowed = (rules: RobotsRules, pathname: string) => {
  const longestMatch = (patterns: string[]) =>
    patterns
      .filter((pattern) => pathname.startsWith(pattern))
      .reduce((longest, pattern) => Math.max(longest, pattern.length), -1);

  const disallowed = longestMatch(rules.disallow);
  if (disallowed === -1) return true;
  return longestMatch(rules.allow) >= disallowed;
};

export class RobotsDisallowedError extends Error {
  constructor(url: string) {
    super(`robots.txt disallows fetching ${url}`);
    this.name = 'RobotsDisallowedError';
  }
}

/** Shared robots-check + per-host queueing for both politeGet and politePost. */
const withPoliteAccess = async <T>(
  url: string,
  run: () => Promise<T>,
): Promise<T> => {
  const parsed = new URL(url);
  const origin = `${parsed.protocol}//${parsed.host}`;

  const rules = await fetchRobots(origin);
  if (!isPathAllowed(rules, parsed.pathname)) {
    throw new RobotsDisallowedError(url);
  }

  return enqueueForHost(parsed.host, run);
};

/**
 * Fetches a URL as text, subject to robots.txt, per-host throttling and a
 * response size cap. Throws on transport errors so callers can skip a source.
 *
 * `accept` defaults to the feed-oriented value every existing caller relies
 * on; ATS JSON sources (see externalJobs/ats/) pass `application/json`
 * instead rather than changing that default for everyone.
 */
export const politeGet = async (
  url: string,
  params?: Record<string, string | number>,
  accept = 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5',
): Promise<string> =>
  withPoliteAccess(url, async () => {
    const response = await axios.get<string>(url, {
      params,
      timeout: REQUEST_TIMEOUT_MS,
      responseType: 'text',
      maxContentLength: MAX_RESPONSE_BYTES,
      maxRedirects: 3,
      headers: { 'User-Agent': USER_AGENT, Accept: accept },
    });
    return String(response.data ?? '');
  });

/**
 * Same guarantees as `politeGet`, for the ATS sources (Workday's CXS API)
 * that only answer to a POST with a JSON body.
 */
export const politePost = async (url: string, body: unknown): Promise<string> =>
  withPoliteAccess(url, async () => {
    const response = await axios.post<string>(url, body, {
      timeout: REQUEST_TIMEOUT_MS,
      responseType: 'text',
      maxContentLength: MAX_RESPONSE_BYTES,
      maxRedirects: 3,
      headers: {
        'User-Agent': USER_AGENT,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    });
    return String(response.data ?? '');
  });
