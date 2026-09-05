import {
  BROAD_TERMS,
  countriesFor,
  dailyFloorQueries,
  MARITIME_COUNTRIES,
  QUERY_GRID,
  ROLE_TERMS,
  SECONDARY_GRID,
  secondaryGridFor,
} from '../services/externalJobs/queryGrid.js';
import { pickRotationSlice } from '../services/externalJobs/rotation.js';
import { isInMaritimeScope } from '../services/externalJobs/scope.js';
import { ExternalJob } from '../services/externalJobs/types.js';

const coreCountries = MARITIME_COUNTRIES.filter(
  ({ depth }) => depth === 'core',
);
// JSearch is the provider that covers every market, so it's the one whose
// grids should match the full country list.
const allCountries = countriesFor('jsearch');
const googleCountries = countriesFor('serpapi');

describe('search term shape', () => {
  // The single highest-impact thing about these terms. Measured live on the
  // same key/country/day: "able seaman" returned 10 in-scope jobs while
  // "able seaman ordinary seaman deckhand jobs" returned 1, and
  // "third engineer second engineer motorman oiler jobs" returned 0. Both
  // providers match the query text against the posting, so every extra word
  // shrinks the result set — and a query matching nothing costs exactly the
  // same quota as one returning a full page.
  const MAX_WORDS = 3;

  it.each([...BROAD_TERMS, ...ROLE_TERMS])(
    '"%s" stays short enough to actually match postings',
    (term) => {
      expect(term.trim().split(/\s+/).length).toBeLessThanOrEqual(MAX_WORDS);
    },
  );

  it('never pads a term with filler words that only narrow the match', () => {
    // "jobs", "vacancies", "careers" etc. appear in almost no job *title*,
    // so they cost recall and buy nothing.
    for (const term of [...BROAD_TERMS, ...ROLE_TERMS]) {
      expect(term).not.toMatch(/\b(jobs?|vacanc(y|ies)|careers?|hiring)\b/i);
    }
  });

  it('does not bundle several ranks into one query', () => {
    // Two ranks in one string is the exact pattern that measured 0-1 results.
    const rankWords =
      /\b(seaman|officer|engineer|deckhand|bosun|motorman|cook|medic|steward|captain|mariner)\b/gi;
    for (const term of [...BROAD_TERMS, ...ROLE_TERMS]) {
      expect((term.match(rankWords) ?? []).length).toBeLessThanOrEqual(1);
    }
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

  it('spends no SerpApi search — floor, role or hub — on a blank market', () => {
    const spent = [
      ...dailyFloorQueries(0, 99, 'serpapi'),
      ...secondaryGridFor('serpapi'),
    ];
    for (const query of spent) {
      expect(blacked).not.toContain(query.location);
    }
  });

  it('spends nothing on a blank market’s hub cities either', () => {
    // Any hub search there would be a guaranteed-zero SerpApi call.
    const serpLocations = secondaryGridFor('serpapi').map((q) => q.location);
    for (const name of blacked) {
      expect(serpLocations.some((l) => l?.includes(name))).toBe(false);
    }
  });
});

describe('dailyFloorQueries', () => {
  it('covers every one of a provider\u2019s countries when the budget allows', () => {
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
    // BROAD_TERMS.length wraps back to term 0 — every country is still
    // covered every day regardless of how many terms are in the rotation,
    // just with whichever phrasing that day lands on.
    const wrapDay = dailyFloorQueries(
      BROAD_TERMS.length,
      allCountries.length,
      'jsearch',
    );

    expect(day0.every((q) => q.q === BROAD_TERMS[0])).toBe(true);
    expect(day1.every((q) => q.q === BROAD_TERMS[1])).toBe(true);
    expect(wrapDay.every((q) => q.q === BROAD_TERMS[0])).toBe(true);
  });

  it('gives every query an explicit country as location', () => {
    for (const query of dailyFloorQueries(0, allCountries.length, 'jsearch')) {
      expect(query.location).toBeTruthy();
    }
  });
});

describe('SECONDARY_GRID', () => {
  it('is role terms x core markets — hub searches are SerpApi-only', () => {
    expect(SECONDARY_GRID).toHaveLength(
      ROLE_TERMS.length * coreCountries.length,
    );

    const serpCore = countriesFor('serpapi').filter(
      ({ depth }) => depth === 'core',
    );
    const serpHubs = countriesFor('serpapi').reduce(
      (total, { hubs }) => total + (hubs?.length ?? 0),
      0,
    );
    expect(secondaryGridFor('serpapi')).toHaveLength(
      ROLE_TERMS.length * serpCore.length + serpHubs,
    );
  });

  it('never repeats a broad term — that coverage belongs to the daily floor only', () => {
    // Re-rotating a broad term here would spend quota re-asking a question
    // the floor already answered for every country today.
    for (const query of SECONDARY_GRID) {
      expect(BROAD_TERMS).not.toContain(query.q);
    }
  });

  it('gives every query an explicit location', () => {
    for (const query of SECONDARY_GRID) {
      expect(query.location).toBeTruthy();
    }
  });

  it('only ever uses a plain country name as the location', () => {
    // JSearch can only resolve a plain country name to an ISO code, so its
    // grid must never carry a city-level location (SerpApi's may).
    const countryNames = new Set(MARITIME_COUNTRIES.map(({ name }) => name));
    for (const query of SECONDARY_GRID) {
      expect(countryNames.has(query.location as string)).toBe(true);
    }
  });

  it('contains no duplicate country/term pairs that would spend quota twice', () => {
    const seen = SECONDARY_GRID.map((query) => `${query.q}::${query.location}`);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('targets a hub city through `location`, never by naming it in the query', () => {
    // Measured: "seafarer in Aberdeen" @ United Kingdom returns 1 result,
    // while "seafarer" @ Aberdeen,Scotland,United Kingdom returns 10 — the
    // city is a location, not another word the posting must match.
    const aberdeen = secondaryGridFor('serpapi').filter((query) =>
      query.location?.includes('Aberdeen'),
    );

    expect(aberdeen).toHaveLength(1);
    expect(aberdeen[0].location).toBe('Aberdeen,Scotland,United Kingdom');
    expect(aberdeen[0].q).not.toMatch(/Aberdeen/);
    expect(BROAD_TERMS).toContain(aberdeen[0].q);
  });

  it('covers the whole secondary grid within a reasonable rotation at the 3-key leftover budget', () => {
    // 3 SerpApi keys = 24/day, minus the 12-country floor = 12/day left over
    // for the secondary rotation. This just confirms every combination does
    // eventually come back around — listings are never deleted for going
    // unconfirmed (see refresh.ts), so there's no staleness deadline to beat,
    // only "does the rotation actually reach everything".
    const perDay = 12;
    const cycleDays = Math.ceil(SECONDARY_GRID.length / perDay);
    const covered = new Set(
      Array.from({ length: cycleDays }, (_, day) =>
        pickRotationSlice(SECONDARY_GRID, day, perDay),
      )
        .flat()
        .map((query) => `${query.q}::${query.location}`),
    );

    expect(covered.size).toBe(SECONDARY_GRID.length);
  });
});

describe('QUERY_GRID', () => {
  it('is the floor’s full term space plus both providers’ secondary grids', () => {
    const serpHubs = countriesFor('serpapi').reduce(
      (total, { hubs }) => total + (hubs?.length ?? 0),
      0,
    );
    // Role terms are shared between the providers, so they dedupe down to
    // one copy; the hub searches are SerpApi-only and add on top.
    expect(QUERY_GRID).toHaveLength(
      BROAD_TERMS.length * MARITIME_COUNTRIES.length +
        SECONDARY_GRID.length +
        serpHubs,
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
    'ETO Marine Electrician',
    'Superyacht Chef',
    'Radio Officer',
    'Ship Bosun',
    'Cruise Ship Purser',
  ])('keeps a "%s" listing in scope', (title) => {
    // Every ROLE_TERMS search is wasted quota if the filter then drops what it
    // returns, so the ranks those terms target must survive on the title alone.
    expect(isInMaritimeScope(listingFor(title))).toBe(true);
  });

  it.each([
    'Software Engineer',
    'Hotel Steward',
    'Line Cook',
    'Airline Purser',
  ])('still rejects an unrelated "%s" listing', (title) => {
    // "Purser" alone is deliberately not a scope term (scope.ts) — airlines
    // use the same title for cabin crew leads, so a purser listing must
    // still earn scope through another maritime word actually in its text
    // (e.g. "cruise" or "ship", covered above), same as the bare
    // "steward"/"cook" precedent.
    expect(isInMaritimeScope(listingFor(title))).toBe(false);
  });
});
