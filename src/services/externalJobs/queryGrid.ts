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
 *   1. A daily floor — one FLOOR_TERMS search per country, every single day,
 *      unconditionally. This is what guarantees all 12 countries actually get
 *      searched today, rather than waiting their turn in a multi-day rotation.
 *   2. Whatever budget is left over rotates through `secondaryGridFor` — the
 *      shared rank terms, the UK specialist set and the hub-city searches —
 *      via the existing pickRotationSlice machinery.
 */

/**
 * CRITICAL — one title per search, kept SHORT (at most three meaningful words).
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
 * Nor does `OR` work around this — also measured live, UK: SerpApi's
 * `bosun OR "able seaman" OR deckhand` returned 17 results across two pages,
 * every one a bosun posting (even a "Bosun Labs" sales role) and not a single
 * able seaman or deckhand, despite "able seaman" alone returning 10. JSearch
 * behaved the same with the order reversed: 10 of 10 matched only the first
 * term. Neither provider honours OR, so grouping terms to "save quota" just
 * silently drops every term after the first. One title per search.
 *
 * Ambiguity is handled downstream by scope.ts, not by padding the query with
 * maritime words — a bare "chief engineer" still returned 5 in-scope jobs of
 * 10, better than any compound phrase managed. The exception is a bare word
 * whose ordinary meaning swamps the maritime one (Master, Captain, Fitter,
 * Machinist, Steward, Reefer): those are qualified to the ship-board title
 * ("ship master", "marine fitter", ...), the same way the client's own
 * hospitality list prefixes every role with "Ship".
 */

/**
 * The broadest, highest-volume ranks from the client's list — one of these,
 * rotated by day, runs against every country every day (dailyFloorQueries).
 *
 * Adding a term here costs nothing extra per day — the floor always runs
 * exactly one of these per country, so more terms just stretch the phrasing
 * rotation over more days.
 *
 * Every floor term needs high precision, since it runs in every market:
 * "chief officer" was moved out to RANK_TERMS after a live floor run found
 * it mostly returns corporate "Chief <X> Officer" roles (0-9 in scope out of
 * 10-20 per market); "bosun" replaced it (UK: 16 of 17 genuine).
 */
export const FLOOR_TERMS = [
  'deck officer',
  'marine engineer',
  'able seaman',
  'bosun',
  'second engineer',
  'deckhand',
];

/**
 * Common international seagoing ranks — rotated through every market with
 * enough volume for rank-level searches (`depth: 'core'`).
 */
export const RANK_TERMS = [
  // Deck officers
  'ship master',
  'ship captain',
  'chief officer',
  'chief mate',
  'second officer',
  'second mate',
  'third officer',
  'third mate',
  // Engine officers
  'chief engineer',
  'third engineer',
  'fourth engineer',
  'engine cadet',
  // Electro-technical
  'ETO',
  'electrical officer',
  'ship electrician',
  'marine electrician',
  // Deck ratings
  'ordinary seaman',
  'deck rating',
  'deck crew',
  // Engine ratings
  'motorman',
  'oiler',
  'wiper',
  'engine rating',
  'marine fitter',
  'pumpman',
  'engine crew',
  // Catering / hotel
  'chief cook',
  'ship cook',
  'messman',
  'ship steward',
];

/**
 * Ranks that are UK/MCA terminology (OOW, EOOW, Master Mariner) or
 * lower-volume variants of a RANK_TERMS title. Run in `specialistTerms`
 * markets only — spread across every market they'd mostly spend quota on
 * zero-result searches.
 */
export const NICHE_RANK_TERMS = [
  'master mariner',
  'officer of the watch',
  'OOW',
  'navigation officer',
  'first engineer',
  'engineer officer',
  'engineering officer',
  'reefer engineer',
  'EOOW',
  'engine room watchkeeper',
  'watchkeeping engineer',
  'electro technical officer',
  'electrotechnical officer',
  'marine electrical engineer',
  'boatswain',
  'AB seaman',
  'OS seaman',
  'engine fitter',
  'marine machinist',
  'marine cook',
  'galley crew',
  'hotel crew',
  'catering crew',
];

/**
 * Vessel types — these surface jobs a rank-only search misses (a posting
 * titled "LNG Carrier" or "AHTS Crew" with the rank buried in the body).
 *
 * Deliberately left out of the client's list:
 *   - Category headers ("Tanker", "Cargo", "Offshore", "Passenger",
 *     "Specialist") — as bare searches they're swamped by other trades; bare
 *     "tanker" in the UK is mostly road-fuel HGV driving.
 *   - Acronyms that collide with large non-maritime job families: PSV (UK
 *     bus/coach licence), DSV (the DSV logistics company), CSV (the file
 *     format), CTV (UK Counter-Terrorist Check vetting). Their spelled-out
 *     forms are kept instead.
 *   - Variants whose every word is already in a kept term, so a search for
 *     the shorter one already matches those postings: "crude oil tanker"
 *     (oil tanker), "harbour tug" and "anchor handling tug supply" (tug),
 *     "passenger ferry" (ferry), "Roro" (Ro-Ro).
 */
export const VESSEL_TERMS = [
  // Tankers and gas
  'oil tanker',
  'product tanker',
  'chemical tanker',
  'shuttle tanker',
  'bunker tanker',
  'LNG carrier',
  'LNG vessel',
  'LPG carrier',
  'gas carrier',
  // Dry cargo
  'container ship',
  'container vessel',
  'bulk carrier',
  'bulker',
  'general cargo vessel',
  'multipurpose vessel',
  'heavy lift vessel',
  'Ro-Ro',
  'Ropax',
  // Offshore
  'offshore support vessel',
  'OSV',
  'platform supply vessel',
  'AHTS',
  'anchor handler',
  'diving support vessel',
  'construction support vessel',
  'subsea vessel',
  'survey vessel',
  'fish farm vessel',
  // Offshore wind
  'service operation vessel',
  'SOV',
  'crew transfer vessel',
  'offshore wind vessel',
  'wind farm vessel',
  // Passenger
  'ferry',
  'passenger vessel',
  'passenger ship',
  'cruise ship',
  'cruise vessel',
  // Specialist
  'tug',
  'towage',
  'dredger',
  'dredging vessel',
  'research vessel',
  'cable laying vessel',
  'cable layer',
  'yacht',
  'superyacht',
];

/**
 * Certification keywords — catch vacancies written around the required
 * ticket rather than a rank or vessel type. The STCW regulation codes
 * (II/1, II/2, III/1, III/2) and "STCW certificates" are dropped: every
 * posting that cites them also contains "STCW", which is searched directly.
 * Bare "CoC" is dropped too — it's "code of conduct" far more often.
 */
export const CERTIFICATION_TERMS = [
  'STCW',
  'certificate of competency',
  'unlimited CoC',
];

/** Everything a `specialistTerms` market gets on top of RANK_TERMS. */
export const SPECIALIST_TERMS = [
  ...NICHE_RANK_TERMS,
  ...VESSEL_TERMS,
  ...CERTIFICATION_TERMS,
];

/** The broadest floor terms, reused for the city-level hub searches. */
const HUB_TERMS = [FLOOR_TERMS[0], FLOOR_TERMS[1]];

/** The two metered search providers, for coverage routing below. */
export type SearchProvider = 'serpapi' | 'jsearch';

export type MaritimeCountry = {
  name: string;
  /**
   * `core` countries get RANK_TERMS on top of the daily floor — the markets
   * with enough posting volume for rank-specific searches to pay for
   * themselves.
   */
  depth: 'core' | 'broad';
  /**
   * Also rotates SPECIALIST_TERMS (niche/UK-terminology ranks, vessel types,
   * certifications) through this market. Reserved for the priority market:
   * ~70 extra searches per cycle is affordable for one country, not twelve.
   */
  specialistTerms?: boolean;
  /**
   * Port/offshore cities that a country-level query under-covers, because it
   * skews toward the capital. Each hub adds one city-scoped SerpApi search
   * per HUB_TERMS entry.
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
   * this is a per-provider flag rather than removing the country outright —
   * and why JSearch's secondary budget is reserved for exactly these
   * markets (see `secondaryGridFor`).
   */
  noGoogleJobs?: boolean;
};

/**
 * Countries searched every day, in priority order — priority governs how a
 * too-small budget degrades (see `dailyFloorQueries`). UK first: it's the
 * market reported as barely covered, it carries the most hubs, and it's the
 * one market that also gets the full specialist set.
 *
 * Every name here must have a matching entry in countryCodes.ts, or that
 * country silently loses its JSearch coverage.
 */
export const MARITIME_COUNTRIES: MaritimeCountry[] = [
  {
    name: 'United Kingdom',
    depth: 'core',
    specialistTerms: true,
    // Aberdeen is the UK offshore hub and is nearly invisible to a
    // London-weighted national query — the specific gap reported from the field.
    hubs: [
      'Aberdeen,Scotland,United Kingdom',
      'Southampton,England,United Kingdom',
      'Glasgow,Scotland,United Kingdom',
    ],
  },
  // The EEA markets carry no hubs: no SerpApi search is spent on them while
  // `noGoogleJobs` holds, and JSearch has no city-level targeting.
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
  // Promoted from 'broad' to 'core' after measuring the gap live: a
  // floor-only search returned 0 for Egypt/South Africa/Ethiopia on the same
  // day "marine engineer" — a rank search, never run against a 'broad'
  // country — returned 4 genuine, in-scope Egyptian jobs. 'broad' depth was
  // silently leaving real, available jobs unfetched.
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
 * floor. Term rotates daily through FLOOR_TERMS (day 0 uses term 0, day 1
 * term 1, and it wraps once past the end), so the phrasing varies across days
 * without ever skipping a country on any single day. That rotation matters
 * for coverage as well as variety: a term can be market-specific, so cycling
 * terms gives every country several different chances across the week
 * rather than betting it all on one phrasing.
 *
 * Priority-ordered: if the day's budget can't cover every country (a small
 * budget, or a provider running low mid-run), the countries dropped are the
 * lowest-priority ones rather than an arbitrary subset.
 */
export const dailyFloorQueries = (
  dayIndex: number,
  budget: number,
  provider: SearchProvider = 'serpapi',
): ExternalJobQuery[] => {
  if (budget <= 0) return [];

  const term = FLOOR_TERMS[dayIndex % FLOOR_TERMS.length];
  return countriesFor(provider)
    .slice(0, budget)
    .map(({ name }) => ({ q: term, location: name }));
};

/**
 * Merges several query lists so each is spread evenly across the result —
 * a slice of any length then carries a proportional mix of every list,
 * instead of (say) a week of nothing but rank searches followed by a week of
 * nothing but UK vessel searches.
 */
const interleaveEvenly = <T>(lists: T[][]): T[] =>
  lists
    .flatMap((list, listIndex) =>
      list.map((item, i) => ({
        item,
        position: (i + 0.5) / list.length,
        listIndex,
      })),
    )
    .sort((a, b) => a.position - b.position || a.listIndex - b.listIndex)
    .map(({ item }) => item);

/**
 * The searches rotated through with whatever budget the daily floor doesn't
 * spend. Country-level entries never repeat a FLOOR_TERMS term — the floor
 * already asks every country one of those every day.
 *
 * Per provider:
 *   - SerpApi (the larger budget): RANK_TERMS across every `core` market it
 *     serves, SPECIALIST_TERMS in the `specialistTerms` market, and the
 *     hub-city searches.
 *   - JSearch: RANK_TERMS in the `noGoogleJobs` markets only. Those are the
 *     markets where it's the sole source — spending its much smaller budget
 *     on the UK or India would re-ask what SerpApi's rotation already
 *     covers, while Greece/Norway/the Netherlands/Germany would otherwise get
 *     nothing past the floor.
 */
export const secondaryGridFor = (
  provider: SearchProvider,
): ExternalJobQuery[] => {
  const coreCountries = countriesFor(provider).filter(
    ({ depth }) => depth === 'core',
  );

  if (provider === 'jsearch') {
    const soleSourceMarkets = coreCountries.filter(
      ({ noGoogleJobs }) => noGoogleJobs,
    );
    return RANK_TERMS.flatMap((q) =>
      soleSourceMarkets.map(({ name }) => ({ q, location: name })),
    );
  }

  const rankQueries = RANK_TERMS.flatMap((q) =>
    coreCountries.map(({ name }) => ({ q, location: name })),
  );

  const specialistQueries = coreCountries
    .filter(({ specialistTerms }) => specialistTerms)
    .flatMap(({ name }) =>
      SPECIALIST_TERMS.map((q) => ({ q, location: name })),
    );

  // Hub cities are a SerpApi-only lever: the city goes in `location` (a
  // canonical SerpApi place), which JSearch has no equivalent for.
  const hubQueries = countriesFor(provider).flatMap(({ hubs }) =>
    (hubs ?? []).flatMap((hub) => HUB_TERMS.map((q) => ({ q, location: hub }))),
  );

  return interleaveEvenly([rankQueries, specialistQueries, hubQueries]);
};

/**
 * The full query space across both providers, deduplicated — every floor
 * term against every country, plus each provider's secondary rotation. Not
 * what runs in one day (see dailyFloorQueries / secondaryGridFor for that);
 * this exists for logging and tests that want one "how much ground is
 * covered overall" number.
 */
export const QUERY_GRID: ExternalJobQuery[] = (() => {
  const seen = new Set<string>();
  return [
    ...FLOOR_TERMS.flatMap((q) =>
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
