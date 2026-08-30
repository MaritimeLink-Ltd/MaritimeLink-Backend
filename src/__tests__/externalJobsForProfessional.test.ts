import { prisma } from '../config/prisma.js';
import { getExternalJobsForProfessional } from '../services/externalJobs/index.js';
import { ProfessionalWithResume } from '../services/externalJobs/profileQuery.js';

describe('getExternalJobsForProfessional', () => {
  const testRunId = Date.now();
  const listingIds: string[] = [];

  const makeListing = (
    idSuffix: string,
    overrides: Record<string, unknown> = {},
  ) => {
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
        ...overrides,
      },
    });
  };

  // A profile too sparse to rank on — exercises the unpersonalized branch,
  // which is the simplest path that still exercises the hiddenByAdmin filter
  // and the provider mapping.
  const sparseProfessional = {
    id: 'sparse-test-professional',
    subcategory: null,
    profession: null,
    resume: null,
  } as unknown as ProfessionalWithResume;

  beforeAll(async () => {
    await makeListing('visible-serpapi', { provider: 'serpapi' });
    await makeListing('visible-jsearch', { provider: 'jsearch' });
    await makeListing('visible-feed', { provider: 'feed' });
    await makeListing('hidden', { hiddenByAdmin: true });
  });

  afterAll(async () => {
    await prisma.externalJobListing
      .deleteMany({ where: { id: { in: listingIds } } })
      .catch(() => {});
    await prisma.$disconnect();
  });

  it('excludes listings an admin has removed (hiddenByAdmin)', async () => {
    const { jobs } = await getExternalJobsForProfessional(sparseProfessional);
    const ids = jobs.map((j) => j.id);

    expect(ids).toContain(`test:${testRunId}:visible-serpapi`);
    expect(ids).not.toContain(`test:${testRunId}:hidden`);
  });

  it('preserves the real provider on read-back instead of collapsing non-feed to serpapi', async () => {
    const { jobs } = await getExternalJobsForProfessional(sparseProfessional);

    const jsearchJob = jobs.find(
      (j) => j.id === `test:${testRunId}:visible-jsearch`,
    );
    const serpApiJob = jobs.find(
      (j) => j.id === `test:${testRunId}:visible-serpapi`,
    );
    const feedJob = jobs.find((j) => j.id === `test:${testRunId}:visible-feed`);

    expect(jsearchJob?.provider).toBe('jsearch');
    expect(serpApiJob?.provider).toBe('serpapi');
    expect(feedJob?.provider).toBe('feed');
  });
});
