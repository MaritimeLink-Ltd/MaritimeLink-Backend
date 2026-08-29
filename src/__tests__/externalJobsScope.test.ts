import { isInMaritimeScope } from '../services/externalJobs/scope.js';
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
