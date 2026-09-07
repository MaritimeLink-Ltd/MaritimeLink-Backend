import { ExternalJobQuery } from './types.js';

/**
 * What the daily refresh searches for.
 *
 * Split out from refresh.ts so it stays pure data plus pure functions — no
 * database, no env, no network. That's what lets the tests assert against the
 * real grid rather than a hand-copied duplicate of it, which is the only way a
 * country added here can't silently drift out of step with the JSearch country
 * codes in countryCodes.ts.
 *
 * The day's queries for each provider come in two tiers (see refresh.ts):
 *   1. A daily floor — one broad search per country, every single day,
 *      unconditionally. This is what guarantees all 12 countries actually get
 *      searched today, rather than waiting their turn in a multi-day rotation.
 *   2. Whatever budget is left over rotates through SECONDARY_GRID — the
 *      rank-specific and city-level searches — via the existing
 *      pickRotationSlice machinery.
 */

/**
 * CRITICAL — keep every term here SHORT (one or two words).
 *
 * Google Jobs and JSearch both treat the query as text to match against the
 * posting, so every extra word shrinks the result set. Measured live, same
 * country (UK), same key, same day:
 *
 *   "able seaman ordinary seaman deckhand jobs"  ->  1 result
 *   "able seaman"                                -> 10 results
 *   "third engineer second engineer motorman oiler jobs" -> 0 results
 *   "third officer"                              -> 10 results
 *
 * The old stuffed phrasing was returning 0-1 jobs per search where a plain
 * rank returns a full page of 10 — that, not the date window, was why so few
 * new listings were appearing. Never bundle several ranks into one query to
 * "save quota": a query that matches nothing costs exactly as much as one
 * that returns ten jobs. Add a term instead.
 *
 * Ambiguity is handled downstream by scope.ts, not by padding the query with
 * maritime words — a bare "chief engineer" still returned 5 in-scope jobs of
 * 10, better than any compound phrase managed.
 */

/**
 * General terms used for the daily floor — one of these, rotated by day, runs
 * against every country every day. Each is broad enough to return a mix of
 * maritime roles rather than a single rank, and unambiguous enough that
 * almost everything it returns survives the scope filter ("seafarer" and
 * "vessel crew" both measured 10 returned / 10 in-scope).
 *
 * Adding a term here costs nothing extra per day — the floor always runs
 * exactly one of these per country (dailyFloorQueries), so more terms just
 * stretch the phrasing rotation over more days.
 *
 * "merchant navy" used to be here and was removed: it measured 0 real
 * results on JSearch across every market tried (India, Nigeria, Netherlands,
 * Philippines), and on SerpApi its rare hits included non-target content
 * like a "Military Sealift Command" (a US Navy command) posting. "maritime
 * crew" replaced it — measured 10/10 in-scope on SerpApi UK and covered by
 * the existing "maritime" scope term, with none of that risk.
 */
export const BROAD_TERMS = [
  'seafarer',
  'vessel crew',
  'ship crew',
  'maritime crew',
];

/**
 * Rank- and department-specific terms, run only against `core` countries via
 * SECONDARY_GRID.
 *
 * The maritime sector is not just engineers — these exist so ratings,
 * catering, offshore, cruise, medical and specialist roles surface as their
 * own searches rather than competing for space inside one general query.
 * They're held back from low-volume markets because a narrow rank query there
 * usually returns nothing, and an empty search still costs a unit of quota.
 */
export const ROLE_TERMS = [
  // Ratings / deck crew
  'able seaman',
  'deckhand',
  'bosun',
  // Deck officers
  'deck officer',
  'third officer',
  'chief officer',
  // Engine department
  'marine engineer',
  'second engineer',
  'motorman',
  // Catering, medical, and the specialist sectors
  'ship cook',
  'offshore medic',
  'cruise ship crew',
];

/** The single broadest term, used for the city-level hub searches. */
const HUB_TERM = BROAD_TERMS[0];

/** The two metered search providers, for coverage routing below. */
export type SearchProvider = 'serpapi' | 'jsearch';

export type MaritimeCountry = {
  name: string;
  /**
   * `core` countries get ROLE_TERMS on top of the daily floor — the markets
   * with enough posting volume for rank-specific searches to pay for
   * themselves.
   */
  depth: 'core' | 'broad';
  /**
   * Port/offshore cities that a country-level query under-covers, because it
   * skews toward the capital. Each hub adds one city-scoped SerpApi search.
   *
   * These MUST be canonical SerpApi location strings (verified against
   * serpapi.com/locations.json, which is free and unmetered) and are passed
   * as the `location` parameter — not written into the query text. Measured:
   * `q="seafarer in Aberdeen"` + location=United Kingdom returns 1 result,
   * while `q="seafarer"` + location="Aberdeen,Scotland,United Kingdom"
   * returns 10. Naming the city in the query text is just another word the
   * posting has to match, exactly like the stuffed rank phrases were.
   *
   * SerpApi-only: JSearch accepts a country code and nothing finer, so a hub
   * entry there would just duplicate that country's floor search.
   */
  hubs?: string[];
  /**
   * Set where Google Jobs returns nothing for this country, so SerpApi
   * searches skip it and the quota goes to a market that can answer.
   *
   * Measured, not assumed: Greece, Norway, the Netherlands and Germany each
   * returned zero results for every term tried ("seafarer", "marine
   * engineer", "ship crew") and every parameter combination (`location`,
   * `gl`, city-in-query) — while the very same "marine engineer" search
   * returned 5-10 in-scope jobs in Nigeria, Egypt and South Africa on the
   * same key, the same day. SerpApi confirms it resolved the location
   * (`location_used: "Greece"`), so this is Google Jobs having no EEA
   * inventory to serve rather than a bad request on our side.
   *
   * JSearch is unaffected and still covers these markets (it returned a full
   * page for Germany and the Netherlands on "marine engineer"), which is why
   * this is a per-provider flag rather than removing the country outright.
   */
  noGoogleJobs?: boolean;
};

/**
 * Countries searched every day, in priority order — priority governs how a
 * too-small budget degrades (see `dailyFloorQueries`) and which earlier
 * entries the secondary rotation reaches first. UK first: it's the market
 * reported as barely covered, and it carries the most hubs.
 *
 * Every name here must have a matching entry in countryCodes.ts, or that
 * country silently loses its JSearch coverage.
 */
export const MARITIME_COUNTRIES: MaritimeCountry[] = [
  {
    name: 'United Kingdom',
    depth: 'core',
    // Aberdeen is the UK offshore hub and is nearly invisible to a
    // London-weighted national query — the specific gap reported from the field.
    hubs: [
      'Aberdeen,Scotland,United Kingdom',
      'Southampton,England,United Kingdom',
      'Glasgow,Scotland,United Kingdom',
    ],
  },
  // The EEA markets keep their hub cities listed for the record, but no
  // SerpApi search is spent on them while `noGoogleJobs` holds — and JSearch
  // ignores hubs entirely, so these are currently inert.
  { name: 'Greece', depth: 'core', noGoogleJobs: true },
  { name: 'Norway', depth: 'core', noGoogleJobs: true },
  { name: 'Netherlands', depth: 'core', noGoogleJobs: true },
  { name: 'Germany', depth: 'core', noGoogleJobs: true },
  {
    name: 'Philippines',
    depth: 'core',
    hubs: ['Manila,Metro Manila,Philippines'],
  },
  { name: 'India', depth: 'core', hubs: ['Mumbai,Maharashtra,India'] },
  { name: 'Nigeria', depth: 'core', hubs: ['Lagos,Lagos,Nigeria'] },
  // Promoted from 'broad' to 'core' after measuring the gap live: "seafarer"
  // (the only kind of term a 'broad' country ever got, via the daily floor)
  // returned 0 for Egypt/South Africa/Ethiopia on the same day "marine
  // engineer" — a ROLE_TERMS-only search, never run against a 'broad'
  // country — returned 4 genuine, in-scope Egyptian jobs. 'broad' depth was
  // silently leaving real, available jobs unfetched, not correctly skipping
  // thin markets — see LISTING_RETENTION_DAYS below for the cost of this.
  {
    name: 'Egypt',
    depth: 'core',
    hubs: ['Alexandria,Alexandria Governorate,Egypt'],
  },
  {
    name: 'South Africa',
    depth: 'core',
    hubs: ['Cape Town,Western Cape,South Africa'],
  },
  { name: 'Kenya', depth: 'core', hubs: ['Mombasa,Mombasa County,Kenya'] },
  { name: 'Ethiopia', depth: 'core' },
];

/**
 * The countries a given provider can actually return results for. SerpApi
 * skips the markets flagged `noGoogleJobs`; JSearch searches all of them.
 * Spending a search where the provider has no inventory costs exactly as much
 * as one that returns ten jobs, so this is quota straight back in the budget.
 */
export const countriesFor = (provider: SearchProvider): MaritimeCountry[] =>
  provider === 'jsearch'
    ? MARITIME_COUNTRIES
    : MARITIME_COUNTRIES.filter((country) => !country.noGoogleJobs);

/**
 * One query per country the provider covers, every day — the guaranteed
 * floor. Term rotates daily through BROAD_TERMS (day 0 uses term 0, day 1
 * term 1, and it wraps once past the end), so the phrasing varies across days
 * without ever skipping a country on any single day. That rotation matters
 * for coverage as well as variety: a term can be market-specific (JSearch
 * returns a full page for Germany on "marine engineer" but nothing on
 * "seafarer"), so cycling terms gives every country several different chances
 * across the week rather than betting it all on one phrasing.
 *
 * Priority-ordered: if the day's budget can't cover every country (a small
 * budget, or a provider running low mid-run), the countries dropped are the
 * lowest-priority ones — the broad-depth tail — rather than an arbitrary
 * subset.
 */
export const dailyFloorQueries = (
  dayIndex: number,
  budget: number,
  provider: SearchProvider = 'serpapi',
): ExternalJobQuery[] => {
  if (budget <= 0) return [];

  const term = BROAD_TERMS[dayIndex % BROAD_TERMS.length];
  return countriesFor(provider)
    .slice(0, budget)
    .map(({ name }) => ({ q: term, location: name }));
};

/**
 * Rank-specific and city-level searches, rotated through with whatever budget
 * the daily floor doesn't spend. Excludes BROAD_TERMS entirely — the floor
 * already gives every country one of those every day, so repeating them here
 * would just spend quota re-asking a question already answered today.
 */
export const secondaryGridFor = (
  provider: SearchProvider,
): ExternalJobQuery[] => {
  const countries = countriesFor(provider);

  const roleQueries = ROLE_TERMS.flatMap((q) =>
    countries
      .filter(({ depth }) => depth === 'core')
      .map(({ name }) => ({ q, location: name })),
  );

  // Hub cities are a SerpApi-only lever: the city goes in `location` (a
  // canonical SerpApi place), which JSearch has no equivalent for.
  const hubQueries =
    provider === 'serpapi'
      ? countries.flatMap(({ hubs }) =>
          (hubs ?? []).map((hub) => ({ q: HUB_TERM, location: hub })),
        )
      : [];

  return [...roleQueries, ...hubQueries];
};

/**
 * The rank-specific rotation shared by both providers (JSearch's grid, which
 * is the role terms alone — hub searches are SerpApi-only, see above).
 */
export const SECONDARY_GRID: ExternalJobQuery[] = secondaryGridFor('jsearch');

/**
 * The full query space across both providers, deduplicated — every broad term
 * against every country, plus each provider's secondary rotation. Not what
 * runs in one day (see dailyFloorQueries / secondaryGridFor for that); this
 * exists for logging and tests that want one "how much ground is covered
 * overall" number.
 */
export const QUERY_GRID: ExternalJobQuery[] = (() => {
  const seen = new Set<string>();
  return [
    ...BROAD_TERMS.flatMap((q) =>
      MARITIME_COUNTRIES.map(({ name }) => ({ q, location: name })),
    ),
    ...secondaryGridFor('serpapi'),
    ...secondaryGridFor('jsearch'),
  ].filter((query) => {
    const key = `${query.q}::${query.location}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
})();
