import { normalizeJSearchJob } from '../services/externalJobs/jsearchSource.js';

describe('normalizeJSearchJob', () => {
  it('maps a full JSearch result to the shared ExternalJob shape', () => {
    const result = normalizeJSearchJob({
      job_id: 'abc123',
      job_title: 'Chief Officer',
      employer_name: 'Acme Shipping',
      job_city: 'London',
      job_country: 'GB',
      job_description: 'Full role description.',
      job_apply_link: 'https://example.com/apply',
      job_publisher: 'Indeed',
      job_employment_type: 'FULLTIME',
      job_posted_at_datetime_utc: '2026-08-20T00:00:00.000Z',
    });

    expect(result).toEqual({
      id: 'jsearch:abc123',
      title: 'Chief Officer',
      company: 'Acme Shipping',
      location: 'London, GB',
      description: 'Full role description.',
      salary: null,
      postedAt: '2026-08-20T00:00:00.000Z',
      applyLink: 'https://example.com/apply',
      via: 'Indeed',
      thumbnail: null,
      category: null,
      employmentType: 'FULLTIME',
      source: 'external',
      provider: 'jsearch',
    });
  });

  it('returns null when required fields (job_id, job_title) are missing', () => {
    expect(normalizeJSearchJob({ job_title: 'No ID' })).toBeNull();
    expect(normalizeJSearchJob({ job_id: 'no-title' })).toBeNull();
  });

  it('falls back to the unix timestamp when job_posted_at_datetime_utc is absent', () => {
    const result = normalizeJSearchJob({
      job_id: 'x',
      job_title: 'Title',
      job_posted_at_timestamp: 1_755_648_000, // 2025-08-20T00:00:00Z
    });

    expect(result?.postedAt).toBe(new Date(1_755_648_000 * 1000).toISOString());
  });

  it('falls back to the raw job_posted_at string when no structured date is present', () => {
    const result = normalizeJSearchJob({
      job_id: 'x',
      job_title: 'Title',
      job_posted_at: '3 days ago',
    });

    expect(result?.postedAt).toBe('3 days ago');
  });

  it('builds location from city only when country is absent, and null when both are', () => {
    expect(
      normalizeJSearchJob({ job_id: 'x', job_title: 'T', job_city: 'Lagos' })
        ?.location,
    ).toBe('Lagos');
    expect(
      normalizeJSearchJob({ job_id: 'x', job_title: 'T' })?.location,
    ).toBeNull();
  });

  it('treats a blank employer_name as no company, not an empty string', () => {
    expect(
      normalizeJSearchJob({ job_id: 'x', job_title: 'T', employer_name: '   ' })
        ?.company,
    ).toBeNull();
  });
});
