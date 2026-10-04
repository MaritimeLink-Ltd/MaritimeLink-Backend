import { jest } from '@jest/globals';

const politeGet =
  jest.fn<
    (url: string, params?: unknown, accept?: string) => Promise<string>
  >();
class RobotsDisallowedError extends Error {}
jest.unstable_mockModule('../services/externalJobs/politeFetcher.js', () => ({
  politeGet,
  politePost: jest.fn(),
  RobotsDisallowedError,
}));

type AsyncMock = jest.MockedFunction<(...args: unknown[]) => Promise<unknown>>;
const mockPrisma = {
  expiredExternalJob: {
    findMany: jest.fn() as AsyncMock,
    createMany: jest.fn() as AsyncMock,
    deleteMany: jest.fn() as AsyncMock,
  },
  externalJobListing: {
    findMany: jest.fn() as AsyncMock,
    update: jest.fn() as AsyncMock,
    deleteMany: jest.fn() as AsyncMock,
  },
};
jest.unstable_mockModule('../config/prisma.js', () => ({
  prisma: mockPrisma,
  Prisma: {},
}));

const { pickApplyLink, isExpiryProneLink, isUncheckableLink } =
  await import('../services/externalJobs/applyLink.js');
const { relativeToIso } = await import('../services/externalJobs/textUtils.js');
const { pageSaysExpired, checkLink } =
  await import('../services/externalJobs/linkLiveness.js');
const {
  effectivePostedMs,
  isPastMaxAge,
  isDueForLinkCheck,
  isUnverifiableAndUndated,
  verifyFetchedJobs,
  purgeExpiredListings,
  LINK_CHECK_EVERY_DAYS,
  MAX_LISTING_AGE_DAYS,
} = await import('../services/externalJobs/expiry.js');
const { extractDatePosted } =
  await import('../services/externalJobs/postedDate.js');

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-09-29T12:00:00Z');

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.expiredExternalJob.findMany.mockResolvedValue([]);
  mockPrisma.externalJobListing.findMany.mockResolvedValue([]);
});

describe('pickApplyLink', () => {
  it('never picks an expiry-prone re-posting site', () => {
    // bebee measured 95% expired, jobrapido 33-66% — and neither can be checked link by link.
    expect(
      pickApplyLink([
        'https://bebee.com/in/jobs/123',
        'https://in.linkedin.com/jobs/view/456',
      ]),
    ).toBe('https://in.linkedin.com/jobs/view/456');
    expect(isExpiryProneLink('https://za.jobrapido.com/jobpreview/1')).toBe(
      true,
    );
    // jobleads is 40% expired but checkable, so its links are verified individually instead.
    expect(isExpiryProneLink('https://www.jobleads.com/job/1')).toBe(false);
  });

  it('drops a vacancy only listed on such sites', () => {
    // Live case: "Junior Marine Engineer" — bebee, jobrapido, kitjob only.
    expect(
      pickApplyLink([
        'https://bebee.com/in/jobs/1',
        'https://in.jobrapido.com/jobpreview/2',
      ]),
    ).toBeNull();
  });

  it('prefers the employer’s own careers page over job boards', () => {
    // Live case: "Planning Engineer- Ports & Marine" listed on 8 sites.
    expect(
      pickApplyLink([
        'https://in.linkedin.com/jobs/view/1',
        'https://aecom.jobs/job/2',
        'https://www.simplyhired.co.in/job/3',
      ]),
    ).toBe('https://aecom.jobs/job/2');
  });

  it('prefers a board the checker can read over one it can’t', () => {
    expect(
      pickApplyLink([
        'https://uk.linkedin.com/jobs/view/1',
        'https://www.jobleads.com/job/2',
      ]),
    ).toBe('https://www.jobleads.com/job/2');
    expect(isUncheckableLink('https://uk.indeed.com/viewjob?jk=1')).toBe(true);
    expect(isUncheckableLink('https://www.seaandbeyond.com/job/1')).toBe(false);
  });

  it('falls back to a job board, then to nothing', () => {
    expect(pickApplyLink(['https://uk.indeed.com/viewjob?jk=1'])).toBe(
      'https://uk.indeed.com/viewjob?jk=1',
    );
    expect(pickApplyLink([undefined, null, 'not a url'])).toBeNull();
  });
});

describe('relativeToIso', () => {
  it('turns Google Jobs’ relative text into a real date', () => {
    expect(relativeToIso('3 days ago', NOW)).toBe(
      new Date(NOW.getTime() - 3 * DAY).toISOString(),
    );
    // "30+" is more than 30 days — past the age limit, not on it.
    expect(relativeToIso('30+ days ago', NOW)).toBe(
      new Date(NOW.getTime() - 31 * DAY).toISOString(),
    );
    expect(
      isPastMaxAge(
        { postedAt: relativeToIso('30+ days ago', NOW), createdAt: NOW },
        NOW,
      ),
    ).toBe(true);
    expect(relativeToIso('1 month ago', NOW)).toBe(
      new Date(NOW.getTime() - 30 * DAY).toISOString(),
    );
    expect(relativeToIso('5 hours ago', NOW)).toBe(
      new Date(NOW.getTime() - 5 * 60 * 60 * 1000).toISOString(),
    );
    expect(relativeToIso('yesterday', NOW)).toBe(
      new Date(NOW.getTime() - DAY).toISOString(),
    );
    expect(relativeToIso('Just posted', NOW)).toBe(NOW.toISOString());
  });

  it('passes absolute dates through and gives up on anything else', () => {
    expect(relativeToIso('2026-09-20T10:00:00Z', NOW)).toBe(
      '2026-09-20T10:00:00.000Z',
    );
    expect(relativeToIso('recently', NOW)).toBeNull();
    expect(relativeToIso(null, NOW)).toBeNull();
  });
});

describe('pageSaysExpired', () => {
  it.each([
    '<h2>This job is no longer available</h2>',
    '<p>No longer accepting applications</p>',
    '<div>This vacancy has expired.</div>',
    '<span>This position has been filled</span>',
  ])('recognises an expired page: %s', (html) => {
    expect(pageSaysExpired(html)).toBe(true);
  });

  it('ignores the wording inside scripts and styles', () => {
    expect(
      pageSaysExpired(
        '<script>var msg = "This job is no longer available";</script><h1>Second Engineer</h1><p>Apply now</p>',
      ),
    ).toBe(false);
  });

  it('does not fire on an ordinary live job page', () => {
    expect(
      pageSaysExpired(
        '<h1>Chief Officer - LNG Carrier</h1><p>Applications close on 30 October. Available immediately.</p>',
      ),
    ).toBe(false);
  });
});

describe('checkLink', () => {
  const axios404 = Object.assign(new Error('404'), {
    isAxiosError: true,
    response: { status: 404 },
  });
  const axios403 = Object.assign(new Error('403'), {
    isAxiosError: true,
    response: { status: 403 },
  });

  it('reads live and expired pages', async () => {
    politeGet
      .mockResolvedValueOnce('<h1>Bosun</h1>')
      .mockResolvedValueOnce('<p>This job is no longer available</p>');
    const hosts = new Set<string>();
    expect(await checkLink('https://a.example/1', hosts)).toBe('live');
    expect(await checkLink('https://a.example/2', hosts)).toBe('expired');
  });

  it('treats a removed page (404/410) as expired', async () => {
    politeGet.mockRejectedValueOnce(axios404);
    expect(await checkLink('https://a.example/gone', new Set())).toBe(
      'expired',
    );
  });

  it('never deletes on a site it may not read — and stops asking it', async () => {
    const hosts = new Set<string>();
    politeGet.mockRejectedValueOnce(axios403);
    expect(await checkLink('https://www.glassdoor.co.uk/job/1', hosts)).toBe(
      'unknown',
    );
    expect(await checkLink('https://www.glassdoor.co.uk/job/2', hosts)).toBe(
      'unknown',
    );
    expect(politeGet).toHaveBeenCalledTimes(1);

    politeGet.mockRejectedValueOnce(new RobotsDisallowedError('robots'));
    expect(await checkLink('https://uk.linkedin.com/jobs/view/1', hosts)).toBe(
      'unknown',
    );
  });

  it('treats a network failure as unknown, never expired', async () => {
    politeGet.mockRejectedValueOnce(new Error('ETIMEDOUT'));
    expect(await checkLink('https://a.example/slow', new Set())).toBe(
      'unknown',
    );
  });
});

describe('age limit', () => {
  const row = (postedAt: string | null, createdDaysAgo: number) => ({
    postedAt,
    createdAt: new Date(NOW.getTime() - createdDaysAgo * DAY),
  });

  it('measures age from the real posted date', () => {
    // First seen yesterday, but posted 40 days ago: expired.
    const old = row(new Date(NOW.getTime() - 40 * DAY).toISOString(), 1);
    expect(isPastMaxAge(old, NOW)).toBe(true);
    const fresh = row(new Date(NOW.getTime() - 5 * DAY).toISOString(), 1);
    expect(isPastMaxAge(fresh, NOW)).toBe(false);
  });

  it('falls back to first-seen when there is no usable posted date', () => {
    expect(effectivePostedMs(row(null, 10))).toBe(NOW.getTime() - 10 * DAY);
    expect(effectivePostedMs(row('3 days ago', 10))).toBe(
      NOW.getTime() - 10 * DAY,
    );
    expect(isPastMaxAge(row(null, MAX_LISTING_AGE_DAYS + 1), NOW)).toBe(true);
    expect(isPastMaxAge(row(null, MAX_LISTING_AGE_DAYS - 1), NOW)).toBe(false);
  });
});

describe('isDueForLinkCheck', () => {
  it('checks every listing exactly once per cycle', () => {
    const ids = Array.from({ length: 200 }, (_, i) => `serpapi:job-${i}`);
    const checksPerId = ids.map(
      (id) =>
        Array.from({ length: LINK_CHECK_EVERY_DAYS }, (_, day) =>
          isDueForLinkCheck(id, day),
        ).filter(Boolean).length,
    );
    expect(new Set(checksPerId)).toEqual(new Set([1]));
  });
});

describe('isUnverifiableAndUndated', () => {
  it('flags only an undated listing on a site the checker can’t read', () => {
    expect(
      isUnverifiableAndUndated({
        postedAt: null,
        applyLink: 'https://uk.linkedin.com/jobs/view/1',
      }),
    ).toBe(true);
    expect(
      isUnverifiableAndUndated({
        postedAt: NOW.toISOString(),
        applyLink: 'https://uk.linkedin.com/jobs/view/1',
      }),
    ).toBe(false);
    expect(
      isUnverifiableAndUndated({
        postedAt: null,
        applyLink: 'https://careers.example.com/1',
      }),
    ).toBe(false);
  });
});

describe('verifyFetchedJobs', () => {
  const job = (
    id: string,
    provider: string,
    applyLink: string | null,
    postedAt: string | null,
  ) =>
    ({ id, provider, applyLink, postedAt }) as unknown as Parameters<
      typeof verifyFetchedJobs
    >[0][number];
  const daysAgo = (n: number) =>
    new Date(NOW.getTime() - n * DAY).toISOString();

  it('drops dead, too-old and unverifiable search results before they are saved', async () => {
    politeGet.mockImplementation(async (url: string) =>
      url.includes('/dead')
        ? '<p>This job is no longer available</p>'
        : '<h1>Bosun</h1>',
    );
    const verdict = await verifyFetchedJobs(
      [
        job('s:live', 'serpapi', 'https://careers.a.example/live', daysAgo(2)),
        job('s:dead', 'serpapi', 'https://careers.b.example/dead', daysAgo(2)),
        job('j:old', 'jsearch', 'https://careers.c.example/1', daysAgo(45)),
        job('j:blind', 'jsearch', 'https://uk.linkedin.com/jobs/view/1', null),
        job(
          'j:dated-blind',
          'jsearch',
          'https://uk.linkedin.com/jobs/view/2',
          daysAgo(3),
        ),
      ],
      NOW,
    );
    expect(verdict.kept.map((j) => j.id).sort()).toEqual([
      'j:dated-blind',
      's:live',
    ]);
    expect(verdict.rejectedIds.sort()).toEqual(['j:blind', 'j:old', 's:dead']);
    expect(verdict.counts).toMatchObject({
      expiryProne: 0,
      tooOld: 1,
      unverifiable: 1,
      deadLink: 1,
    });
  });

  it('applies the 30-day limit to company-board jobs too', async () => {
    const verdict = await verifyFetchedJobs(
      [
        job('lever:c:new', 'lever', 'https://jobs.lever.co/c/1', daysAgo(10)),
        job('lever:c:old', 'lever', 'https://jobs.lever.co/c/2', daysAgo(31)),
        job('workday:s:old', 'workday', 'https://s.wd3.example/2', daysAgo(90)),
      ],
      NOW,
    );
    expect(verdict.kept.map((j) => j.id)).toEqual(['lever:c:new']);
    expect(verdict.rejectedIds.sort()).toEqual([
      'lever:c:old',
      'workday:s:old',
    ]);
    // Remembered, so tomorrow's refresh doesn't re-create them.
    expect(mockPrisma.expiredExternalJob.createMany).toHaveBeenCalledWith({
      data: [{ id: 'lever:c:old' }, { id: 'workday:s:old' }],
      skipDuplicates: true,
    });
    // Board links aren't liveness-checked: the board is re-read in full daily.
    expect(politeGet).not.toHaveBeenCalled();
  });

  it('reads an undated board job’s posted date off its job page', async () => {
    politeGet.mockImplementation(async (url: string) =>
      url.endsWith('/old')
        ? `<script type="application/ld+json">{"@type":"JobPosting","datePosted":"${daysAgo(200)}"}</script>`
        : `<script type="application/ld+json">{"datePosted":"${daysAgo(4)}"}</script>`,
    );
    const verdict = await verifyFetchedJobs(
      [
        job('pinpoint:v:1', 'pinpoint', 'https://v.pinpointhq.com/p/new', null),
        job('pinpoint:v:2', 'pinpoint', 'https://v.pinpointhq.com/p/old', null),
      ],
      NOW,
    );
    expect(verdict.kept).toEqual([
      expect.objectContaining({ id: 'pinpoint:v:1', postedAt: daysAgo(4) }),
    ]);
    expect(verdict.rejectedIds).toEqual(['pinpoint:v:2']);
    expect(verdict.counts.datesFound).toBe(2);
  });

  it('reuses a date found on an earlier run instead of re-reading the page', async () => {
    mockPrisma.externalJobListing.findMany.mockResolvedValue([
      { id: 'pinpoint:v:1', createdAt: new Date(NOW), postedAt: daysAgo(6) },
    ]);
    const verdict = await verifyFetchedJobs(
      [job('pinpoint:v:1', 'pinpoint', 'https://v.pinpointhq.com/p/1', null)],
      NOW,
    );
    expect(verdict.kept[0].postedAt).toBe(daysAgo(6));
    expect(politeGet).not.toHaveBeenCalled();
  });

  it('never re-creates a job already deleted for age', async () => {
    mockPrisma.expiredExternalJob.findMany.mockResolvedValue([
      { id: 'pinpoint:v:9' },
    ]);
    const verdict = await verifyFetchedJobs(
      [job('pinpoint:v:9', 'pinpoint', 'https://v.pinpointhq.com/p/9', null)],
      NOW,
    );
    expect(verdict.kept).toEqual([]);
    expect(verdict.counts.previouslyExpired).toBe(1);
    expect(politeGet).not.toHaveBeenCalled();
  });

  it('ages an undated job from when it was first seen, not from today', async () => {
    mockPrisma.externalJobListing.findMany.mockResolvedValue([
      {
        id: 'serpapi:x',
        createdAt: new Date(NOW.getTime() - 31 * DAY),
        postedAt: null,
      },
    ]);
    const verdict = await verifyFetchedJobs(
      [job('serpapi:x', 'serpapi', 'https://careers.a.example/x', null)],
      NOW,
    );
    expect(verdict.rejectedIds).toEqual(['serpapi:x']);
  });
});

describe('extractDatePosted', () => {
  it('reads schema.org JobPosting datePosted', () => {
    expect(
      extractDatePosted(
        '<script>{"@type":"JobPosting","datePosted":"2025-05-13T02:50:19+01:00"}</script>',
      ),
    ).toBe('2025-05-13T01:50:19.000Z');
    expect(extractDatePosted('<h1>No date here</h1>')).toBeNull();
  });
});

describe('purgeExpiredListings', () => {
  it('deletes over-age jobs from every source and remembers them', async () => {
    mockPrisma.externalJobListing.findMany.mockResolvedValue([
      {
        id: 'lever:c:old',
        provider: 'lever',
        applyLink: 'https://jobs.lever.co/c/2',
        postedAt: daysAgoIso(40),
        createdAt: NOW,
        fetchedAt: NOW,
        hiddenByAdmin: false,
      },
      {
        id: 'pinpoint:v:1',
        provider: 'pinpoint',
        applyLink: 'https://v.pinpointhq.com/p/1',
        postedAt: null,
        createdAt: new Date(NOW.getTime() - 31 * DAY),
        fetchedAt: NOW,
        hiddenByAdmin: false,
      },
      {
        id: 'lever:c:new',
        provider: 'lever',
        applyLink: 'https://jobs.lever.co/c/1',
        postedAt: daysAgoIso(3),
        createdAt: NOW,
        fetchedAt: NOW,
        hiddenByAdmin: false,
      },
    ]);
    const summary = await purgeExpiredListings({ now: NOW });

    expect(summary.tooOldRemoved).toBe(2);
    expect(mockPrisma.externalJobListing.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['lever:c:old', 'pinpoint:v:1'] } },
    });
    expect(mockPrisma.expiredExternalJob.createMany).toHaveBeenCalledWith({
      data: [{ id: 'lever:c:old' }, { id: 'pinpoint:v:1' }],
      skipDuplicates: true,
    });
    // Company-board links aren't liveness-checked.
    expect(politeGet).not.toHaveBeenCalled();
  });
});

function daysAgoIso(n: number) {
  return new Date(NOW.getTime() - n * DAY).toISOString();
}
