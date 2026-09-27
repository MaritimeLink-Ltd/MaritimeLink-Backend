import {
  CERTIFICATION_TERMS,
  countriesFor,
  dailyFloorQueries,
  FLOOR_TERMS,
  MARITIME_COUNTRIES,
  NICHE_RANK_TERMS,
  QUERY_GRID,
  RANK_TERMS,
  secondaryGridFor,
  SPECIALIST_TERMS,
  VESSEL_TERMS,
} from '../services/externalJobs/queryGrid.js';
import { pickRotationSlice } from '../services/externalJobs/rotation.js';
import { isInMaritimeScope } from '../services/externalJobs/scope.js';
import { ExternalJob } from '../services/externalJobs/types.js';

// JSearch is the provider that covers every market, so it's the one whose
// floor should match the full country list.
const allCountries = countriesFor('jsearch');
const googleCountries = countriesFor('serpapi');
const serpGrid = secondaryGridFor('serpapi');
const jsearchGrid = secondaryGridFor('jsearch');
const countryNames = new Set(MARITIME_COUNTRIES.map(({ name }) => name));

const ALL_TERMS = [...FLOOR_TERMS, ...RANK_TERMS, ...SPECIALIST_TERMS];

describe('search term shape', () => {
  // The single highest-impact thing about these terms. Measured live on the
  // same key/country/day: "able seaman" returned 10 in-scope jobs while
  // "able seaman ordinary seaman deckhand jobs" returned 1, and
  // "third engineer second engineer motorman oiler jobs" returned 0. Both
  // providers match the query text against the posting, so every extra word
  // shrinks the result set — and a query matching nothing costs exactly the
  // same quota as one returning a full page.
  const MAX_MEANINGFUL_WORDS = 3;
  const STOP_WORDS = new Set(['of', 'the']);

  it.each(ALL_TERMS)(
    '"%s" stays short enough to actually match postings',
    (term) => {
      const words = term
        .trim()
        .split(/\s+/)
        .filter((word) => !STOP_WORDS.has(word.toLowerCase()));
      expect(words.length).toBeLessThanOrEqual(MAX_MEANINGFUL_WORDS);
    },
  );

  it('never pads a term with filler words that only narrow the match', () => {
    // "jobs", "vacancies", "careers" etc. appear in almost no job *title*,
    // so they cost recall and buy nothing.
    for (const term of ALL_TERMS) {
      expect(term).not.toMatch(/\b(jobs?|vacanc(y|ies)|careers?|hiring)\b/i);
    }
  });

  it('never groups several titles into one search', () => {
    // Measured live: neither provider honours OR — `bosun OR "able seaman"
    // OR deckhand` returned only bosun postings on SerpApi, and JSearch
    // matched only the first term too. Grouping silently drops every term
    // after the first.
    for (const term of ALL_TERMS) {
      expect(term).not.toMatch(/\bor\b|\band\b|[,|/"]/i);
    }
  });

  it('does not search a bare word whose ordinary meaning swamps the maritime one', () => {
    // Each of these, searched alone, returns mostly another trade: Master
    // (degrees, Scrum), Captain/First Officer (airline pilots), Fitter,
    // Machinist, Steward, Reefer (refrigerated haulage), Tanker (UK road-fuel
    // HGV), and acronyms that collide with large non-maritime job families.
    const ambiguous = [
      'master',
      'captain',
      'first officer',
      'fitter',
      'machinist',
      'steward',
      'reefer',
      'tanker',
      'cargo',
      'offshore',
      'passenger',
      'psv',
      'dsv',
      'csv',
      'ctv',
      'coc',
    ];
    const lowered = new Set(ALL_TERMS.map((term) => term.toLowerCase()));
    for (const word of ambiguous) expect(lowered.has(word)).toBe(false);
  });

  it('keeps every tier disjoint, with no term searched twice', () => {
    // A term in two tiers would be rotated twice per cycle for the same
    // country, spending quota to re-ask the same question.
    const lowered = ALL_TERMS.map((term) => term.toLowerCase());
    expect(new Set(lowered).size).toBe(lowered.length);
  });

  it('builds the specialist set from niche ranks, vessel types and certifications', () => {
    expect(SPECIALIST_TERMS).toEqual([
      ...NICHE_RANK_TERMS,
      ...VESSEL_TERMS,
      ...CERTIFICATION_TERMS,
    ]);
  });
});

describe('per-provider country coverage', () => {
  // Measured live: Greece/Norway/Netherlands/Germany return zero on SerpApi
  // for every term and parameter combination tried, while the same "marine
  // engineer" search returns 5-10 in-scope jobs in Nigeria/Egypt/South
  // Africa. JSearch does serve those markets, so the skip is per-provider.
  const blacked = MARITIME_COUNTRIES.filter((c) => c.noGoogleJobs).map(
    (c) => c.name,
  );

  it('still searches every market on JSearch', () => {
    expect(countriesFor('jsearch')).toHaveLength(MARITIME_COUNTRIES.length);
  });

  it('skips the Google-Jobs-blank markets on SerpApi', () => {
    expect(blacked.length).toBeGreaterThan(0);
    const names = googleCountries.map((c) => c.name);
    for (const name of blacked) expect(names).not.toContain(name);
  });

  it('keeps the markets SerpApi demonstrably does serve', () => {
    const names = googleCountries.map((c) => c.name);
    // Each of these returned in-scope jobs on a live SerpApi search.
    for (const name of ['United Kingdom', 'Nigeria', 'Egypt', 'South Africa']) {
      expect(names).toContain(name);
    }
  });

  it('spends no SerpApi search — floor, rank, specialist or hub — on a blank market', () => {
    const spent = [...dailyFloorQueries(0, 99, 'serpapi'), ...serpGrid];
    for (const query of spent) {
      expect(blacked).not.toContain(query.location);
      expect(blacked.some((name) => query.location?.includes(name))).toBe(
        false,
      );
    }
  });

  it('spends JSearch’s secondary budget only where it is the sole source', () => {
    // SerpApi's larger budget already rotates the same rank terms through
    // every other market — JSearch re-asking them there would be duplicate
    // coverage while the EEA markets got nothing past the floor.
    expect(new Set(jsearchGrid.map((q) => q.location))).toEqual(
      new Set(blacked),
    );
  });
});

describe('dailyFloorQueries', () => {
  it('covers every one of a provider’s countries when the budget allows', () => {
    for (const provider of ['serpapi', 'jsearch'] as const) {
      const covered = countriesFor(provider);
      const floor = dailyFloorQueries(0, covered.length, provider);

      expect(floor).toHaveLength(covered.length);
      expect(new Set(floor.map((q) => q.location)).size).toBe(covered.length);
    }
  });

  it('never skips a country when the budget has room to spare', () => {
    const floor = dailyFloorQueries(0, allCountries.length + 50, 'jsearch');
    expect(floor).toHaveLength(allCountries.length);
  });

  it('degrades by dropping the lowest-priority countries first, not an arbitrary subset', () => {
    const floor = dailyFloorQueries(0, 3, 'jsearch');
    expect(floor.map((q) => q.location)).toEqual([
      allCountries[0].name,
      allCountries[1].name,
      allCountries[2].name,
    ]);
  });

  it('returns nothing when there is no budget at all', () => {
    expect(dailyFloorQueries(0, 0)).toEqual([]);
    expect(dailyFloorQueries(0, -5)).toEqual([]);
  });

  it('rotates the term by day so phrasing varies without ever skipping a country', () => {
    const day0 = dailyFloorQueries(0, allCountries.length, 'jsearch');
    const day1 = dailyFloorQueries(1, allCountries.length, 'jsearch');
    const wrapDay = dailyFloorQueries(
      FLOOR_TERMS.length,
      allCountries.length,
      'jsearch',
    );

    expect(day0.every((q) => q.q === FLOOR_TERMS[0])).toBe(true);
    expect(day1.every((q) => q.q === FLOOR_TERMS[1])).toBe(true);
    expect(wrapDay.every((q) => q.q === FLOOR_TERMS[0])).toBe(true);
  });

  it('gives every query an explicit country as location', () => {
    for (const query of dailyFloorQueries(0, allCountries.length, 'jsearch')) {
      expect(query.location).toBeTruthy();
    }
  });
});

describe('secondary grids', () => {
  const serpCore = googleCountries.filter(({ depth }) => depth === 'core');
  const specialistMarkets = serpCore.filter(
    ({ specialistTerms }) => specialistTerms,
  );
  const serpHubs = googleCountries.reduce(
    (total, { hubs }) => total + (hubs?.length ?? 0),
    0,
  );
  const HUB_TERM_COUNT = 2;

  it('is rank terms x core markets, plus the specialist set and hub searches on SerpApi', () => {
    expect(serpGrid).toHaveLength(
      RANK_TERMS.length * serpCore.length +
        SPECIALIST_TERMS.length * specialistMarkets.length +
        serpHubs * HUB_TERM_COUNT,
    );

    const blacked = MARITIME_COUNTRIES.filter((c) => c.noGoogleJobs);
    expect(jsearchGrid).toHaveLength(RANK_TERMS.length * blacked.length);
  });

  it('runs the specialist set in the UK — the priority market — and nowhere else', () => {
    expect(specialistMarkets.map(({ name }) => name)).toEqual([
      'United Kingdom',
    ]);

    const specialist = new Set(SPECIALIST_TERMS);
    for (const query of [...serpGrid, ...jsearchGrid]) {
      if (specialist.has(query.q))
        expect(query.location).toBe('United Kingdom');
    }
  });

  it('never repeats a floor term at country level — the floor already asks it daily', () => {
    for (const query of [...serpGrid, ...jsearchGrid]) {
      if (countryNames.has(query.location as string)) {
        expect(FLOOR_TERMS).not.toContain(query.q);
      }
    }
  });

  it('gives every query an explicit location', () => {
    for (const query of [...serpGrid, ...jsearchGrid]) {
      expect(query.location).toBeTruthy();
    }
  });

  it('only ever uses a plain country name as a JSearch location', () => {
    // JSearch can only resolve a plain country name to an ISO code, so its
    // grid must never carry a city-level location (SerpApi's may).
    for (const query of jsearchGrid) {
      expect(countryNames.has(query.location as string)).toBe(true);
    }
  });

  it('contains no duplicate country/term pairs that would spend quota twice', () => {
    for (const grid of [serpGrid, jsearchGrid]) {
      const seen = grid.map((query) => `${query.q}::${query.location}`);
      expect(new Set(seen).size).toBe(seen.length);
    }
  });

  it('targets a hub city through `location`, never by naming it in the query', () => {
    // Measured: "seafarer in Aberdeen" @ United Kingdom returns 1 result,
    // while "seafarer" @ Aberdeen,Scotland,United Kingdom returns 10 — the
    // city is a location, not another word the posting must match.
    const aberdeen = serpGrid.filter((query) =>
      query.location?.includes('Aberdeen'),
    );

    expect(aberdeen).toHaveLength(HUB_TERM_COUNT);
    for (const query of aberdeen) {
      expect(query.location).toBe('Aberdeen,Scotland,United Kingdom');
      expect(query.q).not.toMatch(/Aberdeen/);
      expect(FLOOR_TERMS).toContain(query.q);
    }
  });

  it('mixes rank, specialist and hub searches through the rotation instead of running them in blocks', () => {
    // A 16-search day (the 3-key SerpApi leftover) should already carry a
    // bit of each, rather than weeks of one kind before the next starts.
    const specialist = new Set(SPECIALIST_TERMS);
    const firstDay = pickRotationSlice(serpGrid, 0, 16);
    expect(firstDay.some((q) => specialist.has(q.q))).toBe(true);
    expect(firstDay.some((q) => RANK_TERMS.includes(q.q))).toBe(true);

    const firstWeek = pickRotationSlice(serpGrid, 0, 16 * 7);
    expect(firstWeek.some((q) => !countryNames.has(q.location as string))).toBe(
      true,
    );
  });

  it.each([
    // 3 keys x 8/day minus the 8-country floor; 3 keys x 6/day minus the 12-country floor.
    ['serpapi', serpGrid, 16],
    ['jsearch', jsearchGrid, 6],
  ] as const)(
    '%s rotation reaches every combination within a month at the 3-key budget',
    (_provider, grid, perDay) => {
      // Adding keywords at a fixed budget stretches how long any single
      // search waits for its next turn — this is the guard against a list
      // growing past what the budget can actually cycle through.
      const cycleDays = Math.ceil(grid.length / perDay);
      expect(cycleDays).toBeLessThanOrEqual(30);

      const covered = new Set(
        Array.from({ length: cycleDays }, (_, day) =>
          pickRotationSlice(grid, day, perDay),
        )
          .flat()
          .map((query) => `${query.q}::${query.location}`),
      );
      expect(covered.size).toBe(grid.length);
    },
  );
});

describe('QUERY_GRID', () => {
  it('is the floor’s full term space plus both providers’ secondary grids', () => {
    // No overlap to dedupe: floor terms never appear at country level in a
    // secondary grid, and SerpApi's and JSearch's secondary markets are disjoint.
    expect(QUERY_GRID).toHaveLength(
      FLOOR_TERMS.length * MARITIME_COUNTRIES.length +
        serpGrid.length +
        jsearchGrid.length,
    );
  });

  it('gives the UK the widest coverage of any single market', () => {
    // Counts hub searches too: their location is a city string that ends in
    // the country name ("Aberdeen,Scotland,United Kingdom").
    const shareFor = (country: string) =>
      QUERY_GRID.filter((query) => query.location?.endsWith(country)).length;

    const others = MARITIME_COUNTRIES.filter(
      ({ name }) => name !== 'United Kingdom',
    ).map(({ name }) => shareFor(name));

    expect(shareFor('United Kingdom')).toBeGreaterThan(Math.max(...others));
  });
});

describe('search terms against the maritime scope filter', () => {
  const listingFor = (title: string): ExternalJob =>
    ({
      title,
      company: null,
      location: 'Aberdeen, United Kingdom',
      description: '',
      category: null,
      provider: 'serpapi',
    }) as ExternalJob;

  it.each([
    'Able Seaman',
    'Ordinary Seaman',
    'Third Officer',
    'Motorman',
    'Messman',
    'Deck Cadet',
    'Engine Cadet',
    'Offshore Medic',
    'Cruise Ship Nurse',
    'Ship Captain',
    'Master Mariner',
    'Electro-Technical Officer',
    'Electro Technical Officer',
    'ETO Marine Electrician',
    'Superyacht Chef',
    'Radio Officer',
    'Ship Bosun',
    'Cruise Ship Purser',
    'Officer of the Watch',
    'OOW',
    'EOOW',
    'Watchkeeping Engineer',
    'Engine Room Watchkeeper',
    'Boatswain',
    'Pumpman',
    'Deck Crew',
    'Reefer Engineer',
    'LNG Carrier Chief Engineer',
    'Gas Carrier Second Officer',
    'AHTS Master',
    'OSV Chief Engineer',
    'Ro-Ro Chief Officer',
    'Ropax Second Officer',
    'Dredger Master',
  ])('keeps a "%s" listing in scope', (title) => {
    // Every search is wasted quota if the filter then drops what it
    // returns, so the titles those terms target must survive on the title alone.
    expect(isInMaritimeScope(listingFor(title))).toBe(true);
  });

  it.each([
    'Software Engineer',
    'Hotel Steward',
    'Line Cook',
    'Airline Purser',
    // Deliberately not scope terms (scope.ts) — each is an ordinary title
    // in another trade, so a listing must earn scope through another word.
    'Multi-Engine Rating Pilot',
    'Road Towage Driver',
    'Cement Bulker Driver',
    'Cable Layer',
  ])('still rejects an unrelated "%s" listing', (title) => {
    expect(isInMaritimeScope(listingFor(title))).toBe(false);
  });
});
