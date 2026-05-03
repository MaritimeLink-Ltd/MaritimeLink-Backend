import request from 'supertest';
import bcrypt from 'bcryptjs';
import app from '../app.js';
import { prisma } from '../config/prisma.js';

describe('Professional jobs feed filters', () => {
  let professionalId: string;
  let token: string;
  let matchingJobId: string;
  let expiredJobId: string;

  const testEmail = `jobs_${Date.now()}@example.com`;
  const testPassword = 'Password123!';
  const uniqueToken = `filtertoken${Date.now()}`;

  beforeAll(async () => {
    const hashedPassword = await bcrypt.hash(testPassword, 12);
    const professional = await prisma.professional.create({
      data: {
        firstName: 'Filter',
        lastName: 'Tester',
        email: testEmail,
        password: hashedPassword,
      },
    });
    professionalId = professional.id;

    await prisma.professional.update({
      where: { id: professionalId },
      data: { otpCode: '123456', otpExpiresAt: new Date(Date.now() + 10000) },
    });

    await request(app).post('/api/professional/verify-otp').send({
      professionalId,
      code: '123456',
    });

    await request(app).patch('/api/professional/profession').send({
      professionalId,
      profession: 'OFFICER',
    });

    const roleRes = await request(app).patch('/api/professional/role').send({
      professionalId,
      role: 'Deck Officer',
      subcategory: 'Chief Officer',
    });
    token = roleRes.body.token;

    const matchingJob = await prisma.job.create({
      data: {
        title: `Alpha ${uniqueToken}`,
        location: 'London',
        category: 'OFFICER',
        contractType: 'TEMPORARY',
        salary: '1000',
        description: `Match ${uniqueToken}`,
        status: 'ACTIVE',
        isFlagged: false,
        closingDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
    matchingJobId = matchingJob.id;

    const expiredJob = await prisma.job.create({
      data: {
        title: `Expired ${uniqueToken}`,
        location: 'London',
        category: 'OFFICER',
        contractType: 'TEMPORARY',
        salary: '1000',
        description: `Expired ${uniqueToken}`,
        status: 'ACTIVE',
        isFlagged: false,
        closingDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      },
    });
    expiredJobId = expiredJob.id;
  });

  afterAll(async () => {
    if (expiredJobId) {
      await prisma.job.delete({ where: { id: expiredJobId } }).catch(() => {});
    }
    if (matchingJobId) {
      await prisma.job.delete({ where: { id: matchingJobId } }).catch(() => {});
    }
    if (professionalId) {
      await prisma.professional
        .delete({ where: { id: professionalId } })
        .catch(() => {});
    }
    await prisma.$disconnect();
  });

  it('excludes expired jobs and respects search/filter query params', async () => {
    const res = await request(app)
      .get('/api/professional/jobs')
      .query({
        search: uniqueToken,
        category: 'OFFICER',
        jobType: 'TEMPORARY',
        datePosted: '30d',
      })
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.results).toBe(1);
    expect(Array.isArray(res.body.data.jobs)).toBe(true);
    expect(res.body.data.jobs).toHaveLength(1);
    expect(res.body.data.jobs[0].id).toBe(matchingJobId);
    expect(res.body.data.jobs[0].closingDate).toBeTruthy();
    expect(res.body.data.jobs[0].status).toBe('ACTIVE');
  });
});
