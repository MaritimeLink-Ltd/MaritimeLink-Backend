import bcrypt from 'bcryptjs';
import request from 'supertest';
import app from '../app.js';
import { prisma } from '../config/prisma.js';

describe('Free Professional 10-active-application limit', () => {
  const password = 'Password123!';
  const suffix = Date.now();

  let professionalId: string;
  let professionalToken: string;
  const jobIds: string[] = [];
  const applicationIds: string[] = [];

  beforeAll(async () => {
    const hashed = await bcrypt.hash(password, 12);
    const professional = await prisma.professional.create({
      data: {
        fullname: `Limit Test Prof ${suffix}`,
        email: `limit-test-prof-${suffix}@example.com`,
        password: hashed,
        status: 'VERIFIED',
        isVerified: true,
        tier: 'FREE',
      },
    });
    professionalId = professional.id;

    const loginRes = await request(app)
      .post('/api/professional/login')
      .send({ email: professional.email, password });
    professionalToken = loginRes.body.token;

    // 12 admin-owned jobs (recruiterId: null) so the separate recruiter-side
    // 5-applications-per-job cap can never interfere with this test.
    for (let i = 0; i < 12; i += 1) {
      const job = await prisma.job.create({
        data: {
          title: `Limit Test Job ${i} ${suffix}`,
          location: 'Global',
          category: 'OFFICER',
          contractType: 'PERMANENT',
          salary: '$1000/mo',
          description:
            'Job used to test the Free professional application cap.',
          status: 'ACTIVE',
          recruiterId: null,
          adminId: null,
        },
      });
      jobIds.push(job.id);
    }
  });

  afterAll(async () => {
    await prisma.jobApplication.deleteMany({ where: { professionalId } });
    await prisma.job.deleteMany({ where: { id: { in: jobIds } } });
    await prisma.professional
      .delete({ where: { id: professionalId } })
      .catch(() => {});
    await prisma.$disconnect();
  });

  it('accepts applications 1 through 10', async () => {
    for (let i = 0; i < 10; i += 1) {
      const res = await request(app)
        .post(`/api/professional/jobs/${jobIds[i]}/apply`)
        .set('Authorization', `Bearer ${professionalToken}`)
        .send({});
      expect(res.status).toBe(201);
      applicationIds.push(res.body.data.application.id);
    }
  });

  it('blocks the 11th active application with a clear message', async () => {
    const res = await request(app)
      .post(`/api/professional/jobs/${jobIds[10]}/apply`)
      .set('Authorization', `Bearer ${professionalToken}`)
      .send({});

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/10 active job applications/i);
  });

  it('frees up a slot once one of the 10 is withdrawn', async () => {
    await prisma.jobApplication.update({
      where: { id: applicationIds[0] },
      data: { status: 'WITHDRAWN' },
    });

    const res = await request(app)
      .post(`/api/professional/jobs/${jobIds[10]}/apply`)
      .set('Authorization', `Bearer ${professionalToken}`)
      .send({});

    expect(res.status).toBe(201);
    applicationIds.push(res.body.data.application.id);
  });

  it('blocks again once back at 10 active applications', async () => {
    const res = await request(app)
      .post(`/api/professional/jobs/${jobIds[11]}/apply`)
      .set('Authorization', `Bearer ${professionalToken}`)
      .send({});

    expect(res.status).toBe(403);
  });

  it('a PRO-tier professional is not subject to the cap', async () => {
    await prisma.professional.update({
      where: { id: professionalId },
      data: { tier: 'PRO' },
    });
    try {
      const res = await request(app)
        .post(`/api/professional/jobs/${jobIds[11]}/apply`)
        .set('Authorization', `Bearer ${professionalToken}`)
        .send({});
      expect(res.status).toBe(201);
    } finally {
      await prisma.professional.update({
        where: { id: professionalId },
        data: { tier: 'FREE' },
      });
    }
  });
});
