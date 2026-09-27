import {
  fullRefreshSourceOf,
  prunablePrefixes,
} from '../services/externalJobs/prune.js';
import { ExternalJob } from '../services/externalJobs/types.js';

const job = (id: string, provider: ExternalJob['provider']): ExternalJob => ({
  id,
  title: 'Deck Officer',
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
  provider,
});

describe('fullRefreshSourceOf', () => {
  it('keys an ATS listing by provider and company', () => {
    expect(fullRefreshSourceOf('lever:csmcy:abc-123')).toBe('lever:csmcy');
    expect(
      fullRefreshSourceOf('workday:Svitzer:/job/UK-Flex-Pool/Master_JR3878'),
    ).toBe('workday:Svitzer');
  });

  it('treats every feed as one source', () => {
    expect(fullRefreshSourceOf('feed:9f86d081884c7d65')).toBe('feed');
  });
});

describe('prunablePrefixes', () => {
  it('prunes nothing when no full-refresh source returned anything', () => {
    // The production-cron failure: no ATS config, so zero company listings
    // fetched — which must not read as "every company closed every posting".
    expect(prunablePrefixes([])).toEqual([]);
    expect(prunablePrefixes([job('serpapi:x', 'serpapi')])).toEqual([]);
  });

  it('prunes only the companies that actually answered this run', () => {
    // One Lever board up, the other down: only the one that answered can
    // have its missing postings treated as genuinely gone.
    const prefixes = prunablePrefixes([
      job('lever:csmcy:1', 'lever'),
      job('lever:csmcy:2', 'lever'),
      job('workday:Svitzer:/job/a', 'workday'),
    ]);
    expect(prefixes.sort()).toEqual(['lever:csmcy:', 'workday:Svitzer:']);
  });

  it('ends every prefix with the separator so one company never matches another', () => {
    // Without it, `lever:csmcy` would also prune a `lever:csmcy2` board.
    for (const prefix of prunablePrefixes([job('lever:csmcy:1', 'lever')])) {
      expect(prefix.endsWith(':')).toBe(true);
    }
  });
});
