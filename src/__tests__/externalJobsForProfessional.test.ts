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
        // Defaults to "now" so a fixture with no explicit postedAt still
        // sorts near the top under getExternalJobsForProfessional's
        // newest-first ranking. This runs against the real dev database
        // (shared with the live daily refresh, not a mocked one), so an
        // undated fixture — which `byRecency` treats as epoch-old — would
        // otherwise sink below however many real, dated listings currently
        // exist and fall outside MAX_RESULTS. That's an increasingly real
        // risk now that the daily floor searches all 12 countries: the real
        // pool grows every day, this fixture's rank among it must not.
        postedAt: new Date().toISOString(),
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

  // Matches on category alone (40 points, comfortably over MIN_MATCH_SCORE),
  // so both "matched" listings below score identically and only postedAt
  // can decide their order.
  const officerProfessional = {
    id: 'officer-test-professional',
    subcategory: null,
    profession: 'OFFICER',
    resume: null,
  } as unknown as ProfessionalWithResume;

  // Adds "chief" as a second candidate keyword on top of the category match,
  // so a listing whose title also says "Chief Officer" scores meaningfully
  // higher than a plain "Officer" one — needed to prove recency wins even
  // when the scores genuinely differ, not just when they tie.
  const chiefOfficerProfessional = {
    id: 'chief-officer-test-professional',
    subcategory: 'Chief Officer',
    profession: 'OFFICER',
    resume: null,
  } as unknown as ProfessionalWithResume;

  const daysAgo = (n: number) =>
    new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();

  beforeAll(async () => {
    await makeListing('visible-serpapi', { provider: 'serpapi' });
    await makeListing('visible-jsearch', { provider: 'jsearch' });
    await makeListing('visible-feed', { provider: 'feed' });
    await makeListing('hidden', { hiddenByAdmin: true });

    // Identical in every scored field (title/description/location/category)
    // — only postedAt differs, isolating the recency tie-break.
    await makeListing('matched-older', {
      title: 'Officer Role',
      category: 'OFFICER',
      postedAt: daysAgo(3),
    });
    await makeListing('matched-newer', {
      title: 'Officer Role',
      category: 'OFFICER',
      postedAt: daysAgo(0),
    });

    // Deliberately different scores against chiefOfficerProfessional: the
    // "Chief Officer" title earns an extra keyword match on top of the
    // category match, so this one scores higher than a plain "Officer" title
    // — while being the older of the two.
    await makeListing('strong-match-older', {
      title: 'Chief Officer Role',
      category: 'OFFICER',
      postedAt: daysAgo(10),
    });
    await makeListing('weak-match-newer', {
      title: 'Officer Role',
      category: 'OFFICER',
      postedAt: daysAgo(0),
    });
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

  it('breaks a tie between equally-matched jobs by recency, newest first', async () => {
    const { jobs, matchedCount } =
      await getExternalJobsForProfessional(officerProfessional);

    const older = jobs.findIndex(
      (j) => j.id === `test:${testRunId}:matched-older`,
    );
    const newer = jobs.findIndex(
      (j) => j.id === `test:${testRunId}:matched-newer`,
    );

    expect(older).toBeGreaterThanOrEqual(0);
    expect(newer).toBeGreaterThanOrEqual(0);
    // Both cross MIN_MATCH_SCORE on the category match alone, so both land in
    // the matched band ahead of the unpersonalized "others" — this is what
    // proves the ordering came from the tie-break, not from one of them
    // falling into the wrong band.
    expect(newer).toBeLessThan(matchedCount);
    expect(older).toBeLessThan(matchedCount);
    expect(newer).toBeLessThan(older);
  });

  it('ranks a newer, lower-scoring match above an older, higher-scoring one', async () => {
    const { jobs, matchedCount } = await getExternalJobsForProfessional(
      chiefOfficerProfessional,
    );

    const strongOlder = jobs.findIndex(
      (j) => j.id === `test:${testRunId}:strong-match-older`,
    );
    const weakNewer = jobs.findIndex(
      (j) => j.id === `test:${testRunId}:weak-match-newer`,
    );

    expect(strongOlder).toBeGreaterThanOrEqual(0);
    expect(weakNewer).toBeGreaterThanOrEqual(0);
    // Both still land in the matched band — this isn't the weaker one
    // slipping into "others" by accident.
    expect(strongOlder).toBeLessThan(matchedCount);
    expect(weakNewer).toBeLessThan(matchedCount);
    // The real assertion: recency beats relevance for ordering within a
    // band. Score only ever decided which band a job is in.
    expect(weakNewer).toBeLessThan(strongOlder);
  });
});
