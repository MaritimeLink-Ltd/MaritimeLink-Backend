import { dedupeJobs } from '../services/externalJobs/dedupe.js';
import { ExternalJob } from '../services/externalJobs/types.js';

const job = (overrides: Partial<ExternalJob>): ExternalJob => ({
  id: 'id',
  title: 'Chief Engineer',
  company: 'Acme Shipping',
  location: 'London, UK',
  description: '',
  salary: null,
  postedAt: null,
  applyLink: null,
  via: null,
  thumbnail: null,
  category: null,
  employmentType: null,
  source: 'external',
  provider: 'feed',
  ...overrides,
});

describe('dedupeJobs', () => {
  it('collapses the same title/company/location across different providers', () => {
    const feedJob = job({ id: 'feed:1', provider: 'feed' });
    const serpApiJob = job({ id: 'serpapi:1', provider: 'serpapi' });
    const jSearchJob = job({ id: 'jsearch:1', provider: 'jsearch' });

    const result = dedupeJobs([feedJob, serpApiJob, jSearchJob]);

    expect(result).toHaveLength(1);
  });

  it('is case- and whitespace-insensitive on the dedup key', () => {
    const a = job({
      id: 'a',
      title: '  Chief Engineer  ',
      company: 'ACME SHIPPING',
    });
    const b = job({
      id: 'b',
      title: 'chief engineer',
      company: 'acme shipping',
    });

    expect(dedupeJobs([a, b])).toHaveLength(1);
  });

  it('keeps jobs with a different title, company, or location as distinct', () => {
    const a = job({ id: 'a', title: 'Chief Engineer' });
    const b = job({ id: 'b', title: 'Second Engineer' });
    const c = job({ id: 'c', company: 'Different Shipping Co' });
    const d = job({ id: 'd', location: 'Manila, Philippines' });

    expect(dedupeJobs([a, b, c, d])).toHaveLength(4);
  });

  it('prefers the richer record (has applyLink + description) on collision', () => {
    const sparse = job({ id: 'sparse', applyLink: null, description: '' });
    const rich = job({
      id: 'rich',
      applyLink: 'https://example.com/apply',
      description: 'Full role description here.',
    });

    const result = dedupeJobs([sparse, rich]);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('rich');
  });

  it('does not replace a rich record with a sparser one seen later', () => {
    const rich = job({
      id: 'rich',
      applyLink: 'https://example.com/apply',
      description: 'Full role description here.',
    });
    const sparse = job({ id: 'sparse', applyLink: null, description: '' });

    const result = dedupeJobs([rich, sparse]);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('rich');
  });

  it('treats missing company/location as an empty-string key segment, not a crash', () => {
    const a = job({ id: 'a', company: null, location: null });
    const b = job({ id: 'b', company: null, location: null });

    expect(dedupeJobs([a, b])).toHaveLength(1);
  });
});
