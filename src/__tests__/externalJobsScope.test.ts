import {
  hasTitleLevelMaritimeSignal,
  inScopeRatio,
  isInMaritimeScope,
  isWorthABonusPage,
  scopeCompanyBoard,
} from '../services/externalJobs/scope.js';
import { ExternalJob } from '../services/externalJobs/types.js';

const job = (overrides: Partial<ExternalJob>): ExternalJob => ({
  id: 'id',
  title: 'Job',
  company: null,
  location: null,
  description: '',
  salary: null,
  postedAt: null,
  applyLink: null,
  via: null,
  thumbnail: null,
  category: null,
  employmentType: null,
  source: 'external',
  provider: 'serpapi',
  ...overrides,
});

describe('isInMaritimeScope', () => {
  it('always accepts feed-sourced jobs regardless of content (in scope by origin)', () => {
    expect(isInMaritimeScope(job({ provider: 'feed', title: 'Barista' }))).toBe(
      true,
    );
  });

  it('accepts a serpapi job whose title carries a maritime signal', () => {
    expect(
      isInMaritimeScope(
        job({ provider: 'serpapi', title: 'Chief Engineer - Bulk Carrier' }),
      ),
    ).toBe(true);
  });

  it('accepts a jsearch job whose description (not title) carries the signal', () => {
    expect(
      isInMaritimeScope(
        job({
          provider: 'jsearch',
          title: 'Engineer',
          description: 'Join our crew onboard a container ship fleet.',
        }),
      ),
    ).toBe(true);
  });

  it('rejects a serpapi/jsearch job with no maritime signal anywhere', () => {
    expect(
      isInMaritimeScope(
        job({
          provider: 'serpapi',
          title: 'Chief Engineer',
          description: 'Manage the software engineering team.',
        }),
      ),
    ).toBe(false);
    expect(
      isInMaritimeScope(
        job({
          provider: 'jsearch',
          title: 'Steward',
          description: 'Hotel front desk role.',
        }),
      ),
    ).toBe(false);
  });

  it('matches whole words only, not substrings (e.g. "shipping" inside another word)', () => {
    expect(
      isInMaritimeScope(
        job({ provider: 'serpapi', title: 'Worshipping Coordinator' }),
      ),
    ).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(
      isInMaritimeScope(job({ provider: 'serpapi', title: 'SEAFARER wanted' })),
    ).toBe(true);
  });
});

describe('isWorthABonusPage', () => {
  const page = (maritime: number, noise: number): ExternalJob[] => [
    ...Array.from({ length: maritime }, (_, i) =>
      job({ id: `m${i}`, title: 'Deck Crew' }),
    ),
    ...Array.from({ length: noise }, (_, i) =>
      job({ id: `n${i}`, title: 'Chief Financial Officer' }),
    ),
  ];

  it('spends a bonus page on a full, mostly-maritime first page', () => {
    // Shape of a live "deck crew" @ UK result: 17 of 18 in scope.
    expect(isWorthABonusPage(page(9, 1), 10)).toBe(true);
  });

  it('does not spend one on a full page of mostly noise', () => {
    // Shape of a live "chief officer" floor result: corporate "Chief <X>
    // Officer" roles, with the bonus page just as noisy (Ethiopia: 0 of 10).
    expect(isWorthABonusPage(page(2, 8), 10)).toBe(false);
    expect(isWorthABonusPage(page(0, 10), 10)).toBe(false);
  });

  it('never spends one on a page that was not full', () => {
    expect(isWorthABonusPage(page(5, 0), 10)).toBe(false);
    expect(isWorthABonusPage([], 10)).toBe(false);
  });

  it('treats exactly half in scope as worth it', () => {
    expect(isWorthABonusPage(page(5, 5), 10)).toBe(true);
  });
});

describe('isInMaritimeScope — chief officer and port place names', () => {
  it.each([
    'Chief Officer of Human Resources and Professional Development',
    'Chief Officer Public works and Transport',
    'Deputy Chief Officer',
  ])('rejects the public-sector / corporate title "%s"', (title) => {
    expect(isInMaritimeScope(job({ title }))).toBe(false);
  });

  it('keeps a ship chief officer posting through its other maritime words', () => {
    expect(
      isInMaritimeScope(job({ title: 'Chief Officer - Container Ship' })),
    ).toBe(true);
    expect(
      isInMaritimeScope(
        job({
          title: 'Chief Officer',
          description: 'Joining a DP2 offshore vessel in West Africa.',
        }),
      ),
    ).toBe(true);
  });

  it('does not treat a "Port <city>" place name as a port job', () => {
    // Measured live: this exact listing passed scope on its location alone.
    expect(
      isInMaritimeScope(
        job({
          title: 'Chief Operating Officer',
          location: 'Port Harcourt, Nigeria',
          description:
            'Only candidates resident in Port Harcourt will be considered.',
        }),
      ),
    ).toBe(false);
    expect(
      isInMaritimeScope(
        job({ title: 'Accountant', location: 'Port Said, Egypt' }),
      ),
    ).toBe(false);
  });

  it('still keeps genuine port and vessel jobs located in those cities', () => {
    expect(
      isInMaritimeScope(
        job({ title: 'Port Operations Manager', location: 'Port Said, Egypt' }),
      ),
    ).toBe(true);
    expect(
      isInMaritimeScope(
        job({ title: 'Tug Master', location: 'Port Harcourt, Nigeria' }),
      ),
    ).toBe(true);
  });
});

describe('scopeCompanyBoard', () => {
  const titled = (...titles: string[]) =>
    titles.map((title, i) =>
      job({
        id: `b${i}`,
        title,
        provider: 'lever',
        description: 'Our fleet of vessels.',
      }),
    );

  it('keeps only the maritime-titled postings on a corporate board', () => {
    // Boskalis's live board: 20% maritime titles — the rest pass the
    // description check only because every description has the same boilerplate.
    const board = titled(
      'Vessel Manager',
      'Senior Accountant',
      'Junior RPA Developer',
      'Tax Specialist',
      'Financial Controller',
      'Software Developer',
      'Junior Accountant',
      'Informatiemanager',
      'Wegontwerper',
      'Senior Project Inkoper',
    );
    expect(scopeCompanyBoard(board).map((j) => j.title)).toEqual([
      'Vessel Manager',
    ]);
  });

  it('keeps a seagoing board whole, even rank-only titles', () => {
    // Svitzer's live board: 79% maritime titles; its "Master"/"Captain"
    // posts are genuine tug crew.
    const board = titled(
      'Tug Master',
      'Second Engineer',
      'Deckhand',
      'Master',
      'Captain',
      'Chief Mate',
      'Bosun',
      'Marine Operator',
      'Master - Coastal Towage',
      'Legal Specialist',
    );
    expect(scopeCompanyBoard(board)).toHaveLength(10);
  });

  it('judges the board on titles, categories and locations — never descriptions', () => {
    expect(
      hasTitleLevelMaritimeSignal(
        job({ title: 'Plumber', description: 'On a cruise ship.' }),
      ),
    ).toBe(false);
    expect(
      hasTitleLevelMaritimeSignal(
        job({ title: 'Plumber', location: 'Shipboard' }),
      ),
    ).toBe(true);
    expect(
      hasTitleLevelMaritimeSignal(job({ title: 'Cook', category: 'Offshore' })),
    ).toBe(true);
  });

  it('keeps a board too small to classify whole', () => {
    // Stena's live board: two genuine openings whose titles carry no scope term.
    const board = titled('Junior Officers Deck', 'Junior Officers Engine');
    expect(scopeCompanyBoard(board)).toHaveLength(2);
    expect(scopeCompanyBoard([])).toEqual([]);
  });

  it.each([
    '3rd Engineer - ERRV',
    'Cook - ERRV',
    'Fast Rescue Craft Coxswain - ERRV',
    'Daughter Craft Coxswain - ERRV/MRV',
    '2nd Officer',
  ])('recognises the crew shorthand in "%s"', (title) => {
    expect(hasTitleLevelMaritimeSignal(job({ title }))).toBe(true);
  });
});

describe('inScopeRatio', () => {
  it('is the share of the page that passes the maritime filter', () => {
    const page = [
      job({ id: 'a', title: 'Deck Crew' }),
      job({ id: 'b', title: 'Chief Financial Officer' }),
      job({ id: 'c', title: 'Bosun' }),
      job({ id: 'd', title: 'Accountant' }),
    ];
    expect(inScopeRatio(page)).toBe(0.5);
  });

  it('is 0 for an empty page rather than dividing by zero', () => {
    expect(inScopeRatio([])).toBe(0);
  });
});
