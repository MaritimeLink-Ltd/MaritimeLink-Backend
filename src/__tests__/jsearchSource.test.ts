import {
  isUsJob,
  normalizeJSearchJob,
} from '../services/externalJobs/jsearchSource.js';

describe('normalizeJSearchJob', () => {
  it('maps a full JSearch result to the shared ExternalJob shape', () => {
    const result = normalizeJSearchJob(
      {
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
      },
      'United Kingdom',
    );

    expect(result).toEqual({
      id: 'jsearch:abc123',
      title: 'Chief Officer',
      company: 'Acme Shipping',
      location: 'London, United Kingdom',
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

  it('never builds the location from job_country, even when no target country is passed', () => {
    // job_country is proven untrustworthy (see isUsJob) — it must never
    // appear in the displayed location, with or without a target country.
    const result = normalizeJSearchJob({
      job_id: 'x',
      job_title: 'T',
      job_city: 'Lagos',
      job_country: 'DE',
    });

    expect(result?.location).toBe('Lagos');
    expect(result?.location).not.toContain('DE');
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

  it('builds location from city + target country, and null when both are absent', () => {
    expect(
      normalizeJSearchJob(
        { job_id: 'x', job_title: 'T', job_city: 'Lagos' },
        'Nigeria',
      )?.location,
    ).toBe('Lagos, Nigeria');
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

describe('isUsJob', () => {
  // Reproduces the exact live-measured leak: JSearch returns a US posting
  // for a non-US country query and stamps job_country with whatever code was
  // requested — job_state is the only field that still tells the truth.
  it('flags a job whose job_state is a real US state, regardless of job_country', () => {
    expect(
      isUsJob({
        job_city: 'Houston',
        job_state: 'Texas',
        job_country: 'DE', // the leak: echoes the requested country
      }),
    ).toBe(true);
  });

  it('is not fooled by trailing whitespace on job_state', () => {
    expect(isUsJob({ job_state: '  California ' })).toBe(true);
  });

  it('does not flag a job with no job_state', () => {
    expect(isUsJob({ job_city: 'Lagos', job_country: 'NG' })).toBe(false);
  });

  it('does not flag a genuine non-US region name', () => {
    expect(isUsJob({ job_city: 'Mumbai', job_state: 'Maharashtra' })).toBe(
      false,
    );
    expect(isUsJob({ job_city: 'Aberdeen', job_state: 'Scotland' })).toBe(
      false,
    );
  });
});
