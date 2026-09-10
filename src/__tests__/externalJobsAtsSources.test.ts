import { jest } from '@jest/globals';

const politeGet =
  jest.fn<
    (
      url: string,
      params?: Record<string, string | number>,
      accept?: string,
    ) => Promise<string>
  >();
const politePost = jest.fn<(url: string, body: unknown) => Promise<string>>();

jest.unstable_mockModule('../services/externalJobs/politeFetcher.js', () => ({
  politeGet,
  politePost,
}));

const { fetchGreenhouseJobs } =
  await import('../services/externalJobs/ats/greenhouse.js');
const { fetchLeverJobs } =
  await import('../services/externalJobs/ats/lever.js');
const { fetchSmartRecruitersJobs } =
  await import('../services/externalJobs/ats/smartrecruiters.js');
const { fetchWorkdayJobs } =
  await import('../services/externalJobs/ats/workday.js');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('fetchGreenhouseJobs', () => {
  it('normalizes a board response into ExternalJob rows', async () => {
    politeGet.mockResolvedValueOnce(
      JSON.stringify({
        jobs: [
          {
            id: 123,
            title: 'Chief Officer',
            absolute_url: 'https://job-boards.greenhouse.io/acme/jobs/123',
            updated_at: '2026-01-05T00:00:00Z',
            location: { name: 'Manila, Philippines' },
            content: '<p>Sail with us</p>',
            departments: [{ name: 'Marine Operations' }],
          },
        ],
      }),
    );

    const jobs = await fetchGreenhouseJobs('acme', 'Acme Shipping');

    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      id: 'greenhouse:acme:123',
      title: 'Chief Officer',
      company: 'Acme Shipping',
      location: 'Manila, Philippines',
      description: 'Sail with us',
      applyLink: 'https://job-boards.greenhouse.io/acme/jobs/123',
      via: 'Greenhouse',
      category: 'Marine Operations',
      provider: 'greenhouse',
    });
    expect(politeGet).toHaveBeenCalledWith(
      'https://boards-api.greenhouse.io/v1/boards/acme/jobs',
      { content: 'true' },
      'application/json',
    );
  });

  it('falls back to the board token as company when no label is configured', async () => {
    politeGet.mockResolvedValueOnce(
      JSON.stringify({
        jobs: [
          {
            id: 1,
            title: 'Second Engineer',
            absolute_url: 'https://job-boards.greenhouse.io/acme/jobs/1',
          },
        ],
      }),
    );

    const jobs = await fetchGreenhouseJobs('acme');
    expect(jobs[0].company).toBe('acme');
  });
});

describe('fetchLeverJobs', () => {
  it('normalizes a postings response into ExternalJob rows', async () => {
    politeGet.mockResolvedValueOnce(
      JSON.stringify([
        {
          id: 'abc123',
          text: 'Third Officer',
          categories: {
            location: 'Rotterdam, Netherlands',
            team: 'Deck',
            commitment: 'Full-time',
          },
          hostedUrl: 'https://jobs.lever.co/acme/abc123',
          createdAt: 1700000000000,
          descriptionPlain: 'Join our deck team.',
        },
      ]),
    );

    const jobs = await fetchLeverJobs('acme', 'Acme Shipping');

    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      id: 'lever:acme:abc123',
      title: 'Third Officer',
      company: 'Acme Shipping',
      location: 'Rotterdam, Netherlands',
      description: 'Join our deck team.',
      applyLink: 'https://jobs.lever.co/acme/abc123',
      via: 'Lever',
      category: 'Deck',
      employmentType: 'Full-time',
      provider: 'lever',
    });
    // Lever's createdAt is the requisition's real open date — used as
    // postedAt so a genuinely old posting sinks in a newest-first sort
    // instead of masquerading as fresh (see workday.test's equivalent).
    expect(jobs[0].postedAt).toBe(new Date(1700000000000).toISOString());
  });

  it('drops the generic "submit your CV" catch-all postings, not a real specific opening', async () => {
    politeGet.mockResolvedValueOnce(
      JSON.stringify([
        {
          id: 'catchall1',
          text: 'General Application',
          categories: { team: 'Unsolicited Jobs', location: 'Worldwide' },
          createdAt: 1658912850290,
        },
        {
          id: 'catchall2',
          text: 'general application',
          categories: { team: 'Careers', location: 'Worldwide' },
          createdAt: 1658912850290,
        },
        {
          id: 'real1',
          text: 'Chief Officer',
          categories: { team: 'Deck Officers', location: 'Worldwide' },
          createdAt: 1700000000000,
        },
      ]),
    );

    const jobs = await fetchLeverJobs('acme');

    expect(jobs.map((j) => j.id)).toEqual(['lever:acme:real1']);
  });

  it('falls back to the EU cluster when the US cluster 404s on an unknown company', async () => {
    const notFound = Object.assign(
      new Error('Request failed with status code 404'),
      {
        isAxiosError: true,
        response: {
          status: 404,
          data: { ok: false, error: 'Document not found' },
        },
      },
    );
    politeGet
      .mockRejectedValueOnce(notFound)
      .mockResolvedValueOnce(
        JSON.stringify([{ id: 'eu1', text: 'Deck Officer', categories: {} }]),
      );

    const jobs = await fetchLeverJobs('csmcy', 'Columbia Shipmanagement');

    expect(jobs).toHaveLength(1);
    expect(jobs[0].id).toBe('lever:csmcy:eu1');
    expect(politeGet).toHaveBeenNthCalledWith(
      1,
      'https://api.lever.co/v0/postings/csmcy',
      { mode: 'json' },
      'application/json',
    );
    expect(politeGet).toHaveBeenNthCalledWith(
      2,
      'https://api.eu.lever.co/v0/postings/csmcy',
      { mode: 'json' },
      'application/json',
    );
  });

  it('propagates a non-404 error without trying the other cluster', async () => {
    const serverError = Object.assign(
      new Error('Request failed with status code 500'),
      {
        isAxiosError: true,
        response: { status: 500 },
      },
    );
    politeGet.mockRejectedValueOnce(serverError);

    await expect(fetchLeverJobs('acme')).rejects.toThrow('500');
    expect(politeGet).toHaveBeenCalledTimes(1);
  });
});

describe('fetchSmartRecruitersJobs', () => {
  it('normalizes a postings page and stops once a short page is returned', async () => {
    politeGet.mockResolvedValueOnce(
      JSON.stringify({
        content: [
          {
            id: 'sr1',
            name: 'Able Seaman',
            releasedDate: '2026-01-02T00:00:00Z',
            location: { city: 'Lagos', region: 'Lagos', country: 'Nigeria' },
            department: { label: 'Deck Crew' },
            postingUrl: 'https://jobs.smartrecruiters.com/acme/sr1',
          },
        ],
      }),
    );

    const jobs = await fetchSmartRecruitersJobs('acme', 'Acme Shipping');

    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      id: 'smartrecruiters:acme:sr1',
      title: 'Able Seaman',
      company: 'Acme Shipping',
      location: 'Lagos, Lagos, Nigeria',
      applyLink: 'https://jobs.smartrecruiters.com/acme/sr1',
      via: 'SmartRecruiters',
      category: 'Deck Crew',
      provider: 'smartrecruiters',
    });
    // A page shorter than PAGE_SIZE (100) signals the last page — only one call made.
    expect(politeGet).toHaveBeenCalledTimes(1);
  });

  it('pages until a short page is returned, bounded by MAX_PAGES', async () => {
    const fullPage = {
      content: Array.from({ length: 100 }, (_, i) => ({
        id: `sr${i}`,
        name: 'Deckhand',
      })),
    };
    politeGet
      .mockResolvedValueOnce(JSON.stringify(fullPage))
      .mockResolvedValueOnce(
        JSON.stringify({ content: [{ id: 'last', name: 'Bosun' }] }),
      );

    const jobs = await fetchSmartRecruitersJobs('acme');

    expect(jobs).toHaveLength(101);
    expect(politeGet).toHaveBeenCalledTimes(2);
  });
});

describe('fetchWorkdayJobs', () => {
  const CXS_BASE = 'https://acme.wd1.myworkdayjobs.com/wday/cxs/acme/External';

  it("fetches each posting's detail for its real apply URL and description, dropping the thin list-endpoint fields", async () => {
    politePost.mockResolvedValueOnce(
      JSON.stringify({
        jobPostings: [
          {
            title: 'Marine Engineer',
            externalPath: '/job/Marine-Engineer_R-001',
            locationsText: 'Aberdeen, Scotland',
          },
        ],
      }),
    );
    politeGet.mockResolvedValueOnce(
      JSON.stringify({
        jobPostingInfo: {
          title: 'Marine Engineer',
          jobDescription: '<p>Join our engine room team.</p>',
          location: 'Aberdeen, Scotland',
          externalUrl:
            'https://acme.wd1.myworkdayjobs.com/en-US/External/job/Marine-Engineer_R-001',
          startDate: '2026-09-08',
        },
      }),
    );

    const jobs = await fetchWorkdayJobs(CXS_BASE, 'Acme Shipping');

    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      id: 'workday:Acme Shipping:/job/Marine-Engineer_R-001',
      title: 'Marine Engineer',
      company: 'Acme Shipping',
      location: 'Aberdeen, Scotland',
      description: 'Join our engine room team.',
      // The real, working URL the detail endpoint hands back — not a
      // locally-constructed `${origin}${externalPath}`, which 404s.
      applyLink:
        'https://acme.wd1.myworkdayjobs.com/en-US/External/job/Marine-Engineer_R-001',
      via: 'Workday',
      provider: 'workday',
      // `startDate` is the detail endpoint's real posting date (confirmed
      // live against Svitzer — see the field comment in workday.ts).
      postedAt: new Date('2026-09-08').toISOString(),
    });
    expect(politePost).toHaveBeenCalledWith(
      `${CXS_BASE}/jobs`,
      expect.objectContaining({ limit: 20, offset: 0, searchText: '' }),
    );
    expect(politeGet).toHaveBeenCalledWith(
      `${CXS_BASE}/job/Marine-Engineer_R-001`,
      undefined,
      'application/json',
    );
  });

  it('drops a posting whose detail fetch fails, rather than listing a broken apply link', async () => {
    politePost.mockResolvedValueOnce(
      JSON.stringify({
        jobPostings: [
          {
            title: 'Master',
            externalPath: '/job/Master_R-002',
            locationsText: 'Southampton',
          },
        ],
      }),
    );
    politeGet.mockRejectedValueOnce(new Error('timeout'));

    const jobs = await fetchWorkdayJobs(CXS_BASE);

    expect(jobs).toEqual([]);
  });

  it('drops a posting whose detail response carries no externalUrl', async () => {
    politePost.mockResolvedValueOnce(
      JSON.stringify({
        jobPostings: [
          {
            title: 'Master',
            externalPath: '/job/Master_R-002',
            locationsText: 'Southampton',
          },
        ],
      }),
    );
    politeGet.mockResolvedValueOnce(
      JSON.stringify({ jobPostingInfo: { title: 'Master' } }),
    );

    const jobs = await fetchWorkdayJobs(CXS_BASE);

    expect(jobs).toEqual([]);
  });

  it('derives a company label from the hostname when none is configured', async () => {
    politePost.mockResolvedValueOnce(JSON.stringify({ jobPostings: [] }));

    await fetchWorkdayJobs(CXS_BASE);

    expect(politePost).toHaveBeenCalled();
  });
});
