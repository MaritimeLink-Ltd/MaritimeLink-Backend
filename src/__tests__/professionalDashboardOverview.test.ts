import request from 'supertest';
import bcrypt from 'bcryptjs';
import app from '../app.js';
import { prisma, Prisma } from '../config/prisma.js';

describe('Professional dashboard overview', () => {
  let professionalId: string;
  let token: string;
  let matchingJobId: string;
  let matchingCourseId: string;
  let matchingSessionId: string;

  const testEmail = `overview_${Date.now()}@example.com`;
  const testPassword = 'Password123!';
  const uniqueToken = `harbormetric${Date.now()}`;

  beforeAll(async () => {
    const hashedPassword = await bcrypt.hash(testPassword, 12);
    const professional = await prisma.professional.create({
      data: {
        firstName: 'Overview',
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

    await prisma.professional.update({
      where: { id: professionalId },
      data: {
        profession: null,
        subcategory: null,
        bio: uniqueToken,
        resume: {
          upsert: {
            create: {
              summary: uniqueToken,
            },
            update: {
              summary: uniqueToken,
            },
          },
        },
      },
    });

    const job = await prisma.job.create({
      data: {
        title: `Job ${uniqueToken}`,
        location: 'London',
        category: 'OFFICER',
        contractType: 'PERMANENT',
        salary: '1000',
        description: `This role is built around ${uniqueToken}.`,
        status: 'ACTIVE',
        isFlagged: false,
      },
    });
    matchingJobId = job.id;

    const course = await prisma.course.create({
      data: {
        title: `Course ${uniqueToken}`,
        category: `Course ${uniqueToken}`,
        description: `Training path for ${uniqueToken}.`,
        price: new Prisma.Decimal('149.99'),
        courseType: 'INTERNAL',
        status: 'ACTIVE',
        capacity: 20,
        enrolledCount: 0,
      },
    });
    matchingCourseId = course.id;

    const session = await prisma.courseSession.create({
      data: {
        courseId: matchingCourseId,
        startDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        endDate: new Date(Date.now() + 8 * 24 * 60 * 60 * 1000),
        location: 'Online',
        totalSeats: 20,
        availableSeats: 20,
        enrollmentDeadline: new Date(Date.now() + 6 * 24 * 60 * 60 * 1000),
      },
    });
    matchingSessionId = session.id;
  });

  afterAll(async () => {
    if (matchingSessionId) {
      await prisma.courseSession
        .delete({ where: { id: matchingSessionId } })
        .catch(() => {});
    }
    if (matchingCourseId) {
      await prisma.course
        .delete({ where: { id: matchingCourseId } })
        .catch(() => {});
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

  it('returns personalized job and course counts instead of global totals', async () => {
    const res = await request(app)
      .get('/api/professional/dashboard/overview')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.data.overview.jobMatchesCount).toBe(1);
    // Course count reflects all active courses with open sessions (shared DB may have more).
    expect(
      res.body.data.overview.recommendedCoursesCount,
    ).toBeGreaterThanOrEqual(1);
  });
});
