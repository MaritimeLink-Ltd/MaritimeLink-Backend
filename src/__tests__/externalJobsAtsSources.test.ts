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
const { fetchPinpointJobs } =
  await import('../services/externalJobs/ats/pinpoint.js');
const { fetchTeamtailorJobs } =
  await import('../services/externalJobs/ats/teamtailor.js');
const { fetchRecruiteeJobs } =
  await import('../services/externalJobs/ats/recruitee.js');

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
  const listPage = (postings: object[]) =>
    JSON.stringify({ content: postings });
  const detail = (overrides: object = {}) =>
    JSON.stringify({
      postingUrl: 'https://jobs.smartrecruiters.com/Boskalis/1-vessel-manager',
      jobAd: {
        sections: {
          companyDescription: { text: '<p>A global leader in dredging.</p>' },
          jobDescription: { text: '<p>Manage the vessel.</p>' },
          qualifications: { text: '<p>Master CoC.</p>' },
        },
      },
      ...overrides,
    });

  it('fetches each kept posting’s detail for its description and canonical URL', async () => {
    politeGet
      .mockResolvedValueOnce(
        listPage([
          {
            id: '1',
            name: 'Vessel Manager',
            releasedDate: '2026-09-20T10:00:00Z',
            location: { city: 'Aberdeen', country: 'gb' },
            department: { label: 'Marine' },
          },
        ]),
      )
      .mockResolvedValueOnce(detail());

    const jobs = await fetchSmartRecruitersJobs('boskalis', 'Boskalis');

    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      id: 'smartrecruiters:boskalis:1',
      title: 'Vessel Manager',
      company: 'Boskalis',
      location: 'Aberdeen, gb',
      applyLink: 'https://jobs.smartrecruiters.com/Boskalis/1-vessel-manager',
      category: 'Marine',
      postedAt: new Date('2026-09-20T10:00:00Z').toISOString(),
      provider: 'smartrecruiters',
    });
    // Job-specific sections only — the company boilerplate would make every
    // office role look maritime.
    expect(jobs[0].description).toContain('Manage the vessel.');
    expect(jobs[0].description).not.toContain('global leader');
    expect(politeGet).toHaveBeenLastCalledWith(
      'https://api.smartrecruiters.com/v1/companies/boskalis/postings/1',
      undefined,
      'application/json',
    );
  });

  it('spends no detail request on a posting the keep filter drops', async () => {
    politeGet
      .mockResolvedValueOnce(
        listPage([
          { id: '1', name: 'Vessel Manager' },
          { id: '2', name: 'Senior Accountant' },
        ]),
      )
      .mockResolvedValueOnce(detail());

    const jobs = await fetchSmartRecruitersJobs('boskalis', undefined, (all) =>
      all.filter((j) => j.title === 'Vessel Manager'),
    );

    expect(jobs.map((j) => j.id)).toEqual(['smartrecruiters:boskalis:1']);
    expect(politeGet).toHaveBeenCalledTimes(2); // one list page + one detail
  });

  it('drops a posting whose detail fails or carries no public page', async () => {
    politeGet
      .mockResolvedValueOnce(
        listPage([
          { id: '1', name: 'Vessel Manager' },
          { id: '2', name: 'Marine Pilot' },
        ]),
      )
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce(detail({ postingUrl: undefined }));

    expect(await fetchSmartRecruitersJobs('boskalis')).toEqual([]);
  });

  it('pages the list until a short page is returned', async () => {
    const fullPage = listPage(
      Array.from({ length: 100 }, (_, i) => ({
        id: `sr${i}`,
        name: 'Deckhand',
      })),
    );
    politeGet
      .mockResolvedValueOnce(fullPage)
      .mockResolvedValueOnce(listPage([{ id: 'last', name: 'Bosun' }]));

    // Keep nothing so no detail requests are made — this is about paging.
    await fetchSmartRecruitersJobs('acme', undefined, () => []);

    expect(politeGet).toHaveBeenCalledTimes(2);
  });
});

describe('fetchPinpointJobs', () => {
  it('normalizes a postings feed, with no fabricated date', async () => {
    politeGet.mockResolvedValueOnce(
      JSON.stringify({
        data: [
          {
            id: '334361',
            title: 'Motorman for cruise vessel Ultramarine',
            url: 'https://vgroup.pinpointhq.com/en/postings/abc',
            description: '<p>Join the engine department.</p>',
            key_responsibilities: '<ul><li>Watchkeeping</li></ul>',
            employment_type_text: 'Contract',
            location: { name: 'Shipboard', city: 'London' },
            job: { department: { name: 'Engine' } },
          },
        ],
      }),
    );

    const jobs = await fetchPinpointJobs('vgroup', 'V.Group');

    expect(jobs[0]).toMatchObject({
      id: 'pinpoint:vgroup:334361',
      title: 'Motorman for cruise vessel Ultramarine',
      company: 'V.Group',
      location: 'Shipboard',
      applyLink: 'https://vgroup.pinpointhq.com/en/postings/abc',
      category: 'Engine',
      employmentType: 'Contract',
      postedAt: null,
      provider: 'pinpoint',
    });
    expect(jobs[0].description).toContain('Join the engine department.');
    expect(jobs[0].description).toContain('Watchkeeping');
    expect(politeGet).toHaveBeenCalledWith(
      'https://vgroup.pinpointhq.com/postings.json',
      undefined,
      'application/json',
    );
  });
});

describe('fetchTeamtailorJobs', () => {
  const rss = (items: string) => `<?xml version="1.0"?>
    <rss version="2.0" xmlns:tt="https://teamtailor.com/locations"><channel>
      <title>North Star Shipping</title>${items}
    </channel></rss>`;

  it('normalizes an RSS item with its real publish date and location', async () => {
    politeGet.mockResolvedValueOnce(
      rss(`<item>
        <title>3rd Engineer - ERRV</title>
        <description>&lt;p&gt;Join our ERRV fleet.&lt;/p&gt;</description>
        <pubDate>Wed, 23 Sep 2026 08:12:32 +0100</pubDate>
        <link>https://careers.northstarshipping.co.uk/jobs/8438505-3rd-engineer-errv</link>
        <guid>bd19f44e-ae24</guid>
        <tt:locations><tt:location><tt:city>Aberdeen</tt:city><tt:country>United Kingdom</tt:country></tt:location></tt:locations>
        <tt:department>Offshore</tt:department>
      </item>`),
    );

    const jobs = await fetchTeamtailorJobs('northstarshipping');

    expect(jobs[0]).toMatchObject({
      id: 'teamtailor:northstarshipping:bd19f44e-ae24',
      title: '3rd Engineer - ERRV',
      company: 'North Star Shipping',
      location: 'Aberdeen, United Kingdom',
      description: 'Join our ERRV fleet.',
      postedAt: new Date('Wed, 23 Sep 2026 08:12:32 +0100').toISOString(),
      applyLink:
        'https://careers.northstarshipping.co.uk/jobs/8438505-3rd-engineer-errv',
      category: 'Offshore',
      provider: 'teamtailor',
    });
    expect(politeGet).toHaveBeenCalledWith(
      'https://northstarshipping.teamtailor.com/jobs.rss',
    );
  });

  it('handles several items and several locations per item', async () => {
    politeGet.mockResolvedValueOnce(
      rss(`<item><title>Cook - ERRV</title><link>https://x/1</link><guid>1</guid>
          <tt:locations><tt:location><tt:city>Aberdeen</tt:city><tt:country>United Kingdom</tt:country></tt:location>
          <tt:location><tt:city>Great Yarmouth</tt:city><tt:country>United Kingdom</tt:country></tt:location></tt:locations></item>
        <item><title>Fleet Manager</title><link>https://x/2</link><guid>2</guid></item>`),
    );

    const jobs = await fetchTeamtailorJobs('northstarshipping', 'North Star');

    expect(jobs.map((j) => j.title)).toEqual(['Cook - ERRV', 'Fleet Manager']);
    expect(jobs[0].location).toBe(
      'Aberdeen, United Kingdom / Great Yarmouth, United Kingdom',
    );
    expect(jobs[1].location).toBeNull();
    expect(jobs[0].company).toBe('North Star');
  });
});

describe('fetchRecruiteeJobs', () => {
  it('normalizes an offer, parsing Recruitee’s "YYYY-MM-DD hh:mm:ss UTC" dates', async () => {
    politeGet.mockResolvedValueOnce(
      JSON.stringify({
        offers: [
          {
            id: 2749491,
            title: 'Master (CTV)',
            careers_url: 'https://windcat.recruitee.com/o/master-ctv',
            published_at: '2026-09-17 11:38:57 UTC',
            location: 'Across the UK, Suffolk, United Kingdom',
            department: 'Fleet',
            description: '<p>Command a crew transfer vessel.</p>',
            requirements: '<p>Master 200GT.</p>',
            employment_type_code: 'fulltime_permanent',
            status: 'published',
          },
          { id: 2, title: 'Draft', careers_url: 'https://x', status: 'draft' },
        ],
      }),
    );

    const jobs = await fetchRecruiteeJobs('windcat', 'Windcat');

    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      id: 'recruitee:windcat:2749491',
      title: 'Master (CTV)',
      company: 'Windcat',
      location: 'Across the UK, Suffolk, United Kingdom',
      applyLink: 'https://windcat.recruitee.com/o/master-ctv',
      postedAt: '2026-09-17T11:38:57.000Z',
      category: 'Fleet',
      employmentType: 'Fulltime permanent',
      provider: 'recruitee',
    });
    expect(jobs[0].description).toContain('Command a crew transfer vessel.');
    expect(jobs[0].description).toContain('Master 200GT.');
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
