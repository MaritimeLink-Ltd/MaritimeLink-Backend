import {
  buildVerifiablePlace,
  normalizeJSearchJob,
  verifyJobCountry,
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
    // job_country is proven untrustworthy (see verifyJobCountry) — it must
    // never appear in the displayed location, with or without a target.
    const result = normalizeJSearchJob({
      job_id: 'x',
      job_title: 'T',
      job_city: 'Lagos',
      job_country: 'DE',
    });

    expect(result?.location).toBe('Lagos');
    expect(result?.location).not.toContain('DE');
  });

  it('labels a cityless remote job "Remote" rather than naming a country it can\'t confirm', () => {
    // Only reaches this point by passing verifyJobCountry's remote-only
    // fallback (no city/state to check) — naming a specific country here
    // would claim a certainty the data doesn't support.
    const result = normalizeJSearchJob(
      { job_id: 'x', job_title: 'T', job_is_remote: true },
      'Nigeria',
    );

    expect(result?.location).toBe('Remote');
  });

  it('still shows city + country for a remote job that does carry a real city', () => {
    const result = normalizeJSearchJob(
      { job_id: 'x', job_title: 'T', job_city: 'Lagos', job_is_remote: true },
      'Nigeria',
    );

    expect(result?.location).toBe('Lagos, Nigeria');
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

describe('buildVerifiablePlace', () => {
  it('joins city and state when both are present, for tighter disambiguation', () => {
    expect(
      buildVerifiablePlace({ job_city: 'Cheney', job_state: 'Kansas' }),
    ).toBe('Cheney, Kansas');
  });

  it('falls back to whichever of city/state is present', () => {
    expect(buildVerifiablePlace({ job_city: 'Lagos' })).toBe('Lagos');
    expect(buildVerifiablePlace({ job_state: 'New York' })).toBe('New York');
  });

  it('returns null when there is nothing to verify against', () => {
    expect(buildVerifiablePlace({})).toBeNull();
  });
});

describe('verifyJobCountry', () => {
  // Only the network-free branch (no city/state at all) is exercised here —
  // the real lookup is network-dependent and verified live instead, same
  // convention as this codebase's other network-touching helpers (e.g.
  // serpApiSource.ts's getSerpApiQuota has no direct unit test either).
  // Measured live reproductions of the leak this replaces are documented on
  // the function itself.

  it('trusts job_is_remote only when there is no city/state to check', async () => {
    await expect(verifyJobCountry({ job_is_remote: true }, 'ng')).resolves.toBe(
      true,
    );
  });

  it('does not trust a bare remote flag once a real place is present', async () => {
    // "remote" doesn't mean location-agnostic — measured live, a remote
    // JSearch listing still carries a real (often wrong-country) job_state,
    // so a job with a place always goes through the real lookup, not the
    // remote shortcut.
    await expect(
      verifyJobCountry({ job_is_remote: true, job_state: 'New York' }, 'ng'),
    ).resolves.toBe(false);
  }, 20000);

  it('rejects a non-remote job with nothing to verify', async () => {
    await expect(verifyJobCountry({}, 'ng')).resolves.toBe(false);
  });
});
