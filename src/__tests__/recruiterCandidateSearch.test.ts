import bcrypt from 'bcryptjs';
import request from 'supertest';
import app from '../app.js';
import { prisma } from '../config/prisma.js';

describe('Recruiter candidate search', () => {
  let recruiterId: string;
  let recruiterToken: string;
  const password = 'Password123!';
  const suffix = Date.now();

  const candidateIds: string[] = [];

  const createCandidate = async ({
    fullname,
    email,
    rank,
    vesselType,
    years,
    country,
    tier = 'FREE',
  }: {
    fullname: string;
    email: string;
    rank: string;
    vesselType: string;
    years: number;
    country: string;
    tier?: 'FREE' | 'PRO';
  }) => {
    const passwordHash = await bcrypt.hash(password, 12);
    const startYear = 2026 - years;
    const professional = await prisma.professional.create({
      data: {
        fullname,
        email,
        password: passwordHash,
        status: 'VERIFIED',
        isVerified: true,
        tier,
        resume: {
          create: {
            category: 'OFFICER',
            subcategory: rank,
            country,
            seaService: {
              create: [
                {
                  companyName: `${fullname} Shipping`,
                  vesselName: `${fullname} Vessel`,
                  role: rank,
                  vesselType,
                  joiningDate: new Date(`${startYear}-01-01T00:00:00.000Z`),
                  tillDate: new Date('2026-01-01T00:00:00.000Z'),
                },
              ],
            },
          },
        },
      },
    });

    candidateIds.push(professional.id);
    return professional;
  };

  beforeAll(async () => {
    const hashedPassword = await bcrypt.hash(password, 12);
    const recruiter = await prisma.recruiter.create({
      data: {
        email: `search-recruiter-${suffix}@example.com`,
        password: hashedPassword,
        role: 'RECRUITMENT_AGENT',
        isVerified: true,
        status: 'APPROVED',
        // Premium so the candidate-profile test below can assert full resume
        // access without depending on an existing job application.
        tier: 'PREMIUM',
      },
    });

    recruiterId = recruiter.id;

    const loginRes = await request(app)
      .post('/api/recruiter/login')
      .send({ email: recruiter.email, password });

    expect(loginRes.status).toBe(200);
    recruiterToken = loginRes.body.token;

    await createCandidate({
      fullname: 'Alex Morgan',
      email: `alex-morgan-${suffix}@example.com`,
      rank: 'Chief Engineer',
      vesselType: 'Tanker',
      years: 15,
      country: 'Searchland',
    });

    await createCandidate({
      fullname: 'Sarah Chen',
      email: `sarah-chen-${suffix}@example.com`,
      rank: '2nd Officer',
      vesselType: 'Container',
      years: 8,
      country: 'Searchland',
    });

    await createCandidate({
      fullname: 'Marcus Johnson',
      email: `marcus-johnson-${suffix}@example.com`,
      rank: 'Master',
      vesselType: 'Offshore',
      years: 22,
      country: 'Searchland',
    });

    await createCandidate({
      fullname: 'Zara Premium',
      email: `zara-premium-${suffix}@example.com`,
      rank: 'Electrician',
      vesselType: 'Cruise Ship',
      years: 4,
      country: 'Searchland',
      tier: 'PRO',
    });
  });

  afterAll(async () => {
    for (const candidateId of candidateIds) {
      await prisma.professional
        .delete({ where: { id: candidateId } })
        .catch(() => {});
    }

    if (recruiterId) {
      await prisma.recruiter
        .delete({ where: { id: recruiterId } })
        .catch(() => {});
    }

    await prisma.$disconnect();
  });

  it('searches by keyword and rank filters', async () => {
    const res = await request(app)
      .get('/api/recruiter/candidates/search')
      .set('Authorization', `Bearer ${recruiterToken}`)
      .query({
        search: 'Alex',
        rankPosition: 'Chief Engineer',
        limit: 10,
        page: 1,
        sortBy: 'Best Matches',
      });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.total).toBe(1);
    expect(res.body.data.candidates).toHaveLength(1);
    expect(res.body.data.candidates[0].fullname).toBe('Alex Morgan');
  });

  it('filters by experience and vessel type', async () => {
    const res = await request(app)
      .get('/api/recruiter/candidates/search')
      .set('Authorization', `Bearer ${recruiterToken}`)
      .query({
        search: String(suffix),
        experienceLevel: ['6-10 years'],
        vesselType: ['Container'],
        limit: 10,
        page: 1,
        sortBy: 'Best Matches',
      });

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.data.candidates[0].fullname).toBe('Sarah Chen');
    expect(res.body.data.candidates[0].experienceYears).toBeGreaterThanOrEqual(
      6,
    );
    expect(res.body.data.candidates[0].experienceYears).toBeLessThanOrEqual(10);
  });

  it('sorts by experience high to low', async () => {
    const res = await request(app)
      .get('/api/recruiter/candidates/search')
      .set('Authorization', `Bearer ${recruiterToken}`)
      .query({
        search: String(suffix),
        limit: 10,
        page: 1,
        sortBy: 'Experience (High to Low)',
      });

    expect(res.status).toBe(200);
    expect(res.body.data.candidates).toHaveLength(4);
    expect(res.body.data.candidates[0].fullname).toBe('Zara Premium');
    expect(res.body.data.candidates[0].tier).toBe('PRO');
    expect(res.body.data.candidates[1].fullname).toBe('Marcus Johnson');
    expect(res.body.data.candidates[2].fullname).toBe('Alex Morgan');
    expect(res.body.data.candidates[3].fullname).toBe('Sarah Chen');
  });

  it('boosts premium candidates to the top of search results', async () => {
    const res = await request(app)
      .get('/api/recruiter/candidates/search')
      .set('Authorization', `Bearer ${recruiterToken}`)
      .query({
        search: String(suffix),
        limit: 10,
        page: 1,
        sortBy: 'Alphabetical',
      });

    expect(res.status).toBe(200);
    expect(res.body.data.candidates).toHaveLength(4);
    expect(res.body.data.candidates[0].tier).toBe('PRO');
    expect(res.body.data.candidates[0].fullname).toBe('Zara Premium');
    expect(
      res.body.data.candidates
        .slice(1)
        .every((candidate: { tier?: string }) => candidate.tier !== 'PRO'),
    ).toBe(true);
  });

  it('loads a recruiter candidate profile by id', async () => {
    const candidateId = candidateIds[0];
    const res = await request(app)
      .get(`/api/recruiter/professionals/${candidateId}`)
      .set('Authorization', `Bearer ${recruiterToken}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.data.professional.id).toBe(candidateId);
    expect(res.body.data.professional.fullname).toBe('Alex Morgan');
    expect(res.body.data.professional.resume.subcategory).toBe(
      'Chief Engineer',
    );
  });

  it('redacts resume and document wallet for a Free recruiter viewing a non-applicant', async () => {
    const hashedPassword = await bcrypt.hash(password, 12);
    const freeRecruiter = await prisma.recruiter.create({
      data: {
        email: `free-recruiter-${suffix}@example.com`,
        password: hashedPassword,
        role: 'RECRUITMENT_AGENT',
        isVerified: true,
        status: 'APPROVED',
        tier: 'FREE',
      },
    });

    try {
      const loginRes = await request(app)
        .post('/api/recruiter/login')
        .send({ email: freeRecruiter.email, password });
      expect(loginRes.status).toBe(200);

      const candidateId = candidateIds[0];
      const res = await request(app)
        .get(`/api/recruiter/professionals/${candidateId}`)
        .set('Authorization', `Bearer ${loginRes.body.token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.access.viewResume).toBe(false);
      expect(res.body.data.access.viewDocumentWallet).toBe(false);
      expect(res.body.data.professional.resume).toBeNull();
      expect(res.body.data.professional.documents).toEqual([]);
    } finally {
      await prisma.recruiter.delete({ where: { id: freeRecruiter.id } });
    }
  });
});
