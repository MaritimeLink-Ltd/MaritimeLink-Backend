import { prisma } from '../config/prisma.js';
import { getExternalJobsForProfessional } from '../services/externalJobs/index.js';
import { ProfessionalWithResume } from '../services/externalJobs/profileQuery.js';

/**
 * Pagination correctness: nothing in the pool is ever discarded, only
 * spread across pages — the actual fix for "a whole country's worth of
 * real jobs exists in the database but a professional never sees them"
 * (the old fixed MAX_RESULTS cutoff silently dropped everything past it).
 */
describe('getExternalJobsForProfessional pagination', () => {
  const testRunId = Date.now();
  const listingIds: string[] = [];

  const makeListing = (idSuffix: string, daysAgo: number) => {
    const id = `test:${testRunId}:${idSuffix}`;
    listingIds.push(id);
    return prisma.externalJobListing.create({
      data: {
        id,
        title: `Test Job ${idSuffix} ${testRunId}`,
        company: 'Test Co',
        location: 'International Waters',
        description: 'A test listing.',
        provider: 'serpapi',
        fetchedAt: new Date(),
        postedAt: new Date(Date.now() - daysAgo * 86400000).toISOString(),
      },
    });
  };

  const sparseProfessional = {
    id: 'sparse-pagination-professional',
    subcategory: null,
    profession: null,
    resume: null,
  } as unknown as ProfessionalWithResume;

  // 5 listings, deliberately out of chronological order when created, so a
  // correct implementation has to actually sort them, not just preserve
  // insertion order.
  beforeAll(async () => {
    await makeListing('day-3', 3);
    await makeListing('day-1', 1);
    await makeListing('day-5', 5);
    await makeListing('day-0', 0);
    await makeListing('day-2', 2);
  });

  afterAll(async () => {
    await prisma.externalJobListing
      .deleteMany({ where: { id: { in: listingIds } } })
      .catch(() => {});
    await prisma.$disconnect();
  });

  const ourIds = (jobs: { id: string }[]) =>
    jobs.map((j) => j.id).filter((id) => id.startsWith(`test:${testRunId}:`));

  it('never returns more than `limit` jobs on a page', async () => {
    const { jobs, limit } = await getExternalJobsForProfessional(
      sparseProfessional,
      { page: 1, limit: 2 },
    );
    expect(jobs.length).toBeLessThanOrEqual(2);
    expect(limit).toBe(2);
  });

  it('reports total/pages across the whole pool, not just one page', async () => {
    const { total, pages, limit } = await getExternalJobsForProfessional(
      sparseProfessional,
      { page: 1, limit: 2 },
    );
    expect(total).toBeGreaterThanOrEqual(5); // at least our 5 test rows
    expect(pages).toBe(Math.max(1, Math.ceil(total / limit)));
  });

  it('every test listing is reachable across pages, none silently dropped', async () => {
    const { pages } = await getExternalJobsForProfessional(sparseProfessional, {
      page: 1,
      limit: 25,
    });
    const seen = new Set<string>();
    for (let page = 1; page <= pages; page += 1) {
      const { jobs } = await getExternalJobsForProfessional(
        sparseProfessional,
        {
          page,
          limit: 25,
        },
      );
      ourIds(jobs).forEach((id) => seen.add(id));
    }
    expect(seen.size).toBe(listingIds.length);
  });

  it('orders our test listings newest-first within the paginated stream', async () => {
    const { pages } = await getExternalJobsForProfessional(sparseProfessional, {
      page: 1,
      limit: 200,
    });
    const all: string[] = [];
    for (let page = 1; page <= pages; page += 1) {
      const { jobs } = await getExternalJobsForProfessional(
        sparseProfessional,
        {
          page,
          limit: 200,
        },
      );
      all.push(...ourIds(jobs));
    }
    expect(all).toEqual([
      `test:${testRunId}:day-0`,
      `test:${testRunId}:day-1`,
      `test:${testRunId}:day-2`,
      `test:${testRunId}:day-3`,
      `test:${testRunId}:day-5`,
    ]);
  });

  it('clamps an out-of-range limit to MAX_PAGE_SIZE rather than erroring', async () => {
    const { limit } = await getExternalJobsForProfessional(sparseProfessional, {
      page: 1,
      limit: 10000,
    });
    expect(limit).toBeLessThanOrEqual(100);
  });

  it('never returns fewer than page 1 for an invalid page number', async () => {
    const { jobs: page1 } = await getExternalJobsForProfessional(
      sparseProfessional,
      { page: 0, limit: 10 },
    );
    const { jobs: pageNeg } = await getExternalJobsForProfessional(
      sparseProfessional,
      { page: -5, limit: 10 },
    );
    expect(page1.length).toBeGreaterThan(0);
    expect(pageNeg).toEqual(page1);
  });
});
