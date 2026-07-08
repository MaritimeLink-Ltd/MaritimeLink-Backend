import bcrypt from 'bcryptjs';
import request from 'supertest';
import app from '../app.js';
import { prisma } from '../config/prisma.js';

describe('Recruiter subscription gating (Free / Flex / Premium)', () => {
  const password = 'Password123!';
  const suffix = Date.now();

  let recruiterId: string;
  let recruiterToken: string;
  const professionalIds: string[] = [];
  const professionalTokens: string[] = [];
  const jobIds: string[] = [];

  const createProfessional = async (index: number) => {
    const hashed = await bcrypt.hash(password, 12);
    const professional = await prisma.professional.create({
      data: {
        fullname: `Gating Prof ${index} ${suffix}`,
        email: `gating-prof-${index}-${suffix}@example.com`,
        password: hashed,
        status: 'VERIFIED',
        isVerified: true,
        tier: 'FREE',
      },
    });
    professionalIds.push(professional.id);

    const loginRes = await request(app)
      .post('/api/professional/login')
      .send({ email: professional.email, password });
    professionalTokens.push(loginRes.body.token);
    return professional;
  };

  const jobPayload = (title: string, status: 'ACTIVE' | 'DRAFT') => ({
    title,
    location: 'Global',
    category: 'OFFICER',
    contractType: 'PERMANENT',
    salary: '$1000/mo',
    description: 'Verification job description for gating tests.',
    status,
  });

  beforeAll(async () => {
    const hashedPassword = await bcrypt.hash(password, 12);
    const recruiter = await prisma.recruiter.create({
      data: {
        email: `gating-recruiter-${suffix}@example.com`,
        password: hashedPassword,
        role: 'RECRUITMENT_AGENT',
        isVerified: true,
        status: 'APPROVED',
        tier: 'FREE',
      },
    });
    recruiterId = recruiter.id;

    const loginRes = await request(app)
      .post('/api/recruiter/login')
      .send({ email: recruiter.email, password });
    recruiterToken = loginRes.body.token;

    for (let i = 0; i < 8; i += 1) {
      await createProfessional(i);
    }
  });

  afterAll(async () => {
    await prisma.message.deleteMany({
      where: { conversation: { recruiterId } },
    });
    await prisma.conversation.deleteMany({ where: { recruiterId } });
    if (jobIds.length) {
      await prisma.job.deleteMany({ where: { id: { in: jobIds } } });
    }
    if (professionalIds.length) {
      await prisma.professional.deleteMany({
        where: { id: { in: professionalIds } },
      });
    }
    await prisma.recruiter
      .delete({ where: { id: recruiterId } })
      .catch(() => {});
    await prisma.$disconnect();
  });

  it('logs in the seeded recruiter and professionals', () => {
    expect(recruiterToken).toBeTruthy();
    expect(professionalTokens.filter(Boolean)).toHaveLength(8);
  });

  it('lets a Free recruiter create exactly 1 active job listing', async () => {
    const res = await request(app)
      .post('/api/recruiter/jobs')
      .set('Authorization', `Bearer ${recruiterToken}`)
      .send(jobPayload('Gating Job One', 'ACTIVE'));

    expect(res.status).toBe(201);
    jobIds.push(res.body.data.job.id);
  });

  it('blocks a Free recruiter from a 2nd simultaneous active job listing', async () => {
    const res = await request(app)
      .post('/api/recruiter/jobs')
      .set('Authorization', `Bearer ${recruiterToken}`)
      .send(jobPayload('Gating Job Two', 'ACTIVE'));

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('RECRUITER_JOB_LIMIT');
  });

  it('still allows creating a DRAFT job (not counted against the active-job limit)', async () => {
    const res = await request(app)
      .post('/api/recruiter/jobs')
      .set('Authorization', `Bearer ${recruiterToken}`)
      .send(jobPayload('Gating Job Two Draft', 'DRAFT'));

    expect(res.status).toBe(201);
    jobIds.push(res.body.data.job.id);
  });

  it('accepts up to 5 applications on a non-premium job, then blocks the 6th', async () => {
    const job1Id = jobIds[0];

    for (let i = 0; i < 5; i += 1) {
      const res = await request(app)
        .post(`/api/professional/jobs/${job1Id}/apply`)
        .set('Authorization', `Bearer ${professionalTokens[i]}`)
        .send({});
      expect(res.status).toBe(201);
    }

    const blocked = await request(app)
      .post(`/api/professional/jobs/${job1Id}/apply`)
      .set('Authorization', `Bearer ${professionalTokens[5]}`)
      .send({});

    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('RECRUITER_JOB_APPLICATION_LIMIT');
  });

  it('redacts resume/document wallet for a Free recruiter viewing an applicant', async () => {
    const res = await request(app)
      .get(`/api/recruiter/professionals/${professionalIds[0]}`)
      .set('Authorization', `Bearer ${recruiterToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.access.viewResume).toBe(false);
    expect(res.body.data.access.viewDocumentWallet).toBe(false);
    expect(res.body.data.professional.resume).toBeNull();
    expect(res.body.data.professional.documents).toEqual([]);
  });

  it('redacts resume/document wallet for a Free recruiter viewing a non-applicant too', async () => {
    const res = await request(app)
      .get(`/api/recruiter/professionals/${professionalIds[6]}`)
      .set('Authorization', `Bearer ${recruiterToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.access.viewResume).toBe(false);
  });

  it('blocks a Free recruiter from inviting a candidate', async () => {
    const job1Id = jobIds[0];
    const res = await request(app)
      .post(`/api/recruiter/jobs/${job1Id}/invite/${professionalIds[6]}`)
      .set('Authorization', `Bearer ${recruiterToken}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('RECRUITER_UPGRADE_REQUIRED');
  });

  it('blocks a Free recruiter from messaging a candidate before they apply', async () => {
    const res = await request(app)
      .post('/api/conversations')
      .set('Authorization', `Bearer ${recruiterToken}`)
      .send({ recipientId: professionalIds[6] });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('RECRUITER_UPGRADE_REQUIRED');
  });

  it('still allows a Free recruiter to message a candidate who already applied', async () => {
    const res = await request(app)
      .post('/api/conversations')
      .set('Authorization', `Bearer ${recruiterToken}`)
      .send({ recipientId: professionalIds[0] });

    expect(res.status).toBe(200);
  });

  it('blocks a Free recruiter from Smart Candidate Matching', async () => {
    const job1Id = jobIds[0];
    const res = await request(app)
      .get(`/api/recruiter/jobs/${job1Id}/matches`)
      .set('Authorization', `Bearer ${recruiterToken}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('RECRUITER_UPGRADE_REQUIRED');
  });

  it('surfaces Premium Recruiter listings first and flags isPremiumRecruiter on the job', async () => {
    await prisma.recruiter.update({
      where: { id: recruiterId },
      data: { tier: 'PREMIUM' },
    });
    try {
      const res = await request(app).get('/api/jobs').query({ limit: 50 });
      expect(res.status).toBe(200);
      const ourJob = res.body.data.jobs.find(
        (j: { id: string }) => j.id === jobIds[0],
      );
      expect(ourJob).toBeTruthy();
      expect(ourJob.isPremiumRecruiter).toBe(true);
    } finally {
      await prisma.recruiter.update({
        where: { id: recruiterId },
        data: { tier: 'FREE' },
      });
    }
  });

  it('gives a Free recruiter LOW priority support and a Premium recruiter HIGH priority support', async () => {
    const freeCaseRes = await request(app)
      .post('/api/recruiter/support/cases')
      .set('Authorization', `Bearer ${recruiterToken}`)
      .send({
        subject: 'Free tier test case',
        description: 'Testing support priority.',
        category: 'General',
      });
    expect(freeCaseRes.status).toBe(201);
    expect(freeCaseRes.body.data.case.priority).toBe('LOW');

    await prisma.recruiter.update({
      where: { id: recruiterId },
      data: { tier: 'PREMIUM' },
    });
    try {
      const premiumCaseRes = await request(app)
        .post('/api/recruiter/support/cases')
        .set('Authorization', `Bearer ${recruiterToken}`)
        .send({
          subject: 'Premium tier test case',
          description: 'Testing support priority.',
          category: 'General',
        });
      expect(premiumCaseRes.status).toBe(201);
      expect(premiumCaseRes.body.data.case.priority).toBe('HIGH');
    } finally {
      await prisma.recruiter.update({
        where: { id: recruiterId },
        data: { tier: 'FREE' },
      });
    }
  });

  it('exposes GET /api/recruiter/membership with the 3-tier plan list', async () => {
    const res = await request(app)
      .get('/api/recruiter/membership')
      .set('Authorization', `Bearer ${recruiterToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.membership.tier).toBe('FREE');
    expect(res.body.data.membership.plans).toHaveLength(3);
  });

  it('keeps GET /api/recruiter/settings/billing working after the mapBilling rewrite', async () => {
    const res = await request(app)
      .get('/api/recruiter/settings/billing')
      .set('Authorization', `Bearer ${recruiterToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.billing.currentPlan).toBe('Free Recruiter');
  });

  it('a job with no recruiterId (e.g. admin-owned) is not subject to the 5-application cap', async () => {
    const job = await prisma.job.create({
      data: {
        title: 'Admin-owned job (regression check)',
        location: 'Global',
        category: 'OFFICER',
        contractType: 'PERMANENT',
        salary: '$1',
        description:
          'Confirms the recruiter application cap only applies to recruiter-owned jobs.',
        status: 'ACTIVE',
        recruiterId: null,
        adminId: null,
      },
    });
    jobIds.push(job.id);

    for (let i = 0; i < 6; i += 1) {
      const res = await request(app)
        .post(`/api/professional/jobs/${job.id}/apply`)
        .set('Authorization', `Bearer ${professionalTokens[i]}`)
        .send({});
      expect(res.status).toBe(201);
    }
  });

  it("blocks a recruiter from viewing another recruiter's job applicants", async () => {
    const hashedPassword = await bcrypt.hash(password, 12);
    const otherRecruiter = await prisma.recruiter.create({
      data: {
        email: `gating-other-recruiter-${suffix}@example.com`,
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
        .send({ email: otherRecruiter.email, password });

      const res = await request(app)
        .get(`/api/recruiter/jobs/${jobIds[0]}/applicants`)
        .set('Authorization', `Bearer ${loginRes.body.token}`);

      expect(res.status).toBe(403);
    } finally {
      await prisma.recruiter.delete({ where: { id: otherRecruiter.id } });
    }
  });

  it('redacts resume/CV in the applicants list for a Free recruiter, unredacted once Premium', async () => {
    await prisma.professional.update({
      where: { id: professionalIds[0] },
      data: { cvUrl: 'https://example.com/applicant-cv.pdf' },
    });

    const listRes = await request(app)
      .get(`/api/recruiter/jobs/${jobIds[0]}/applicants`)
      .set('Authorization', `Bearer ${recruiterToken}`);

    expect(listRes.status).toBe(200);
    expect(listRes.body.data.applicants.length).toBeGreaterThan(0);
    for (const applicant of listRes.body.data.applicants) {
      expect(applicant.professional.cvUrl).toBeNull();
      expect(applicant.professional.resume).toBeNull();
      // Compliance is still computed accurately (not gated) for "manage applications".
      expect(applicant.professional.compliance).toBeTruthy();
    }

    await prisma.recruiter.update({
      where: { id: recruiterId },
      data: { tier: 'PREMIUM' },
    });
    try {
      const premiumListRes = await request(app)
        .get(`/api/recruiter/jobs/${jobIds[0]}/applicants`)
        .set('Authorization', `Bearer ${recruiterToken}`);

      expect(premiumListRes.status).toBe(200);
      const withCvUrl = premiumListRes.body.data.applicants.find(
        (a: { professional: { cvUrl: unknown } }) =>
          a.professional.cvUrl !== null,
      );
      expect(withCvUrl).toBeTruthy();
      expect(withCvUrl.professional.cvUrl).toBe(
        'https://example.com/applicant-cv.pdf',
      );
    } finally {
      await prisma.recruiter.update({
        where: { id: recruiterId },
        data: { tier: 'FREE' },
      });
    }
  });

  it('Smart Matching still hides the Document Wallet for a Flex (non-Premium) recruiter, since matches are always non-applicants', async () => {
    const flexJob = await prisma.job.create({
      data: {
        title: 'Flex-active job for matching test',
        location: 'Global',
        category: 'OFFICER',
        contractType: 'PERMANENT',
        salary: '$1',
        description:
          'Job with an active Flex listing, owned by a still-FREE-tier recruiter.',
        status: 'ACTIVE',
        recruiterId,
        isPremiumListing: true,
        premiumListingExpiresAt: new Date(
          Date.now() + 30 * 24 * 60 * 60 * 1000,
        ),
      },
    });
    jobIds.push(flexJob.id);

    await prisma.professionalDocument.create({
      data: {
        professionalId: professionalIds[7],
        category: 'CV_RESUME',
        name: 'Test CV',
        fileUrl: 'https://example.com/test-cv.pdf',
      },
    });

    try {
      const res = await request(app)
        .get(`/api/recruiter/jobs/${flexJob.id}/matches`)
        .set('Authorization', `Bearer ${recruiterToken}`);

      expect(res.status).toBe(200);
      const match = res.body.data.candidates.find(
        (c: { id: string }) => c.id === professionalIds[7],
      );
      if (match) {
        expect(match.documents).toEqual([]);
      }
    } finally {
      await prisma.professionalDocument.deleteMany({
        where: { professionalId: professionalIds[7] },
      });
    }
  });

  it('a Flex-active listing unlocks View Resume for ANY candidate (not just applicants), per the pricing doc — but Document Wallet stays applicant-only', async () => {
    // professionalIds[6] never applied to any of this recruiter's jobs.
    const res = await request(app)
      .get(`/api/recruiter/professionals/${professionalIds[6]}`)
      .set('Authorization', `Bearer ${recruiterToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.access.viewResume).toBe(true);
    expect(res.body.data.access.viewDocumentWallet).toBe(false);
    expect(res.body.data.professional.documents).toEqual([]);
  });

  it('professional membership plan list excludes recruiter Stripe products', async () => {
    const res = await request(app)
      .get('/api/professional/membership')
      .set('Authorization', `Bearer ${professionalTokens[7]}`);

    expect(res.status).toBe(200);
    const names = (
      res.body.data.membership.plans as Array<{ name: string }>
    ).map((p) => p.name.toLowerCase());
    expect(names.some((n) => n.includes('recruiter'))).toBe(false);
  });

  describe('once the recruiter is Premium', () => {
    beforeAll(async () => {
      await prisma.recruiter.update({
        where: { id: recruiterId },
        data: { tier: 'PREMIUM' },
      });
    });

    afterAll(async () => {
      await prisma.recruiter.update({
        where: { id: recruiterId },
        data: { tier: 'FREE' },
      });
    });

    it('allows creating a 2nd simultaneous active job listing', async () => {
      const res = await request(app)
        .post('/api/recruiter/jobs')
        .set('Authorization', `Bearer ${recruiterToken}`)
        .send(jobPayload('Gating Job Premium Unlimited', 'ACTIVE'));

      expect(res.status).toBe(201);
      jobIds.push(res.body.data.job.id);
    });

    it('allows inviting a non-applicant', async () => {
      const job1Id = jobIds[0];
      const res = await request(app)
        .post(`/api/recruiter/jobs/${job1Id}/invite/${professionalIds[6]}`)
        .set('Authorization', `Bearer ${recruiterToken}`);

      expect(res.status).toBe(201);
    });

    it('allows viewing full resume/document wallet for anyone', async () => {
      const res = await request(app)
        .get(`/api/recruiter/professionals/${professionalIds[6]}`)
        .set('Authorization', `Bearer ${recruiterToken}`);

      expect(res.body.data.access.viewResume).toBe(true);
      expect(res.body.data.access.viewDocumentWallet).toBe(true);
    });
  });
});
