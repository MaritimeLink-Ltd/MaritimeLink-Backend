import { jest } from '@jest/globals';
import { createEmailServiceMock } from '../testing/mockEmailService.js';

// Mock Email Service
jest.unstable_mockModule('../services/emailService.js', () =>
  createEmailServiceMock(),
);

const { prisma } = await import('../config/prisma.js');
const request = (await import('supertest')).default;
const app = (await import('../app.js')).default;

describe('Unified Course Routes Integration Tests', () => {
  let trainerId: string;
  let trainerToken: string;
  let courseId: string;
  let draftCourseId: string;
  let sessionId: string;

  const testEmail = `trainer_unified_${Date.now()}@example.com`;
  const testPassword = 'Password123!';

  beforeAll(async () => {
    // 1. Create Trainer
    const trainRes = await request(app).post('/api/recruiter/register').send({
      email: testEmail,
      password: testPassword,
      confirmPassword: testPassword,
      role: 'TRAINING_AGENT',
    });
    expect(trainRes.status).toBe(201);
    trainerId = trainRes.body.data.recruiterId;

    await prisma.recruiter.update({
      where: { id: trainerId },
      data: { isVerified: true, status: 'APPROVED', registrationStep: 6 },
    });

    const loginRes = await request(app)
      .post('/api/recruiter/login')
      .send({ email: testEmail, password: testPassword });
    trainerToken = loginRes.body.token;

    // 2. Create Course
    const courseRes = await request(app)
      .post('/api/courses')
      .set('Authorization', `Bearer ${trainerToken}`)
      .send({
        title: 'Unified Test Course',
        location: 'Test City',
        category: 'SAFETY',
        contractType: 'Full-time',
        description: 'Testing unified routes',
        price: 100,
        currency: 'USD',
        courseType: 'INTERNAL',
      });
    expect(courseRes.status).toBe(201);
    courseId = courseRes.body.data.course.id;
  });

  afterAll(async () => {
    if (draftCourseId) {
      await prisma.course
        .delete({ where: { id: draftCourseId } })
        .catch(() => {});
    }
    await prisma.courseSession
      .deleteMany({ where: { courseId } })
      .catch(() => {});
    await prisma.course.delete({ where: { id: courseId } }).catch(() => {});
    await prisma.recruiter.delete({ where: { id: trainerId } }).catch(() => {});
    await prisma.$disconnect();
  });

  it('POST /api/courses/drafts - should save a course as draft', async () => {
    const res = await request(app)
      .post('/api/courses/drafts')
      .set('Authorization', `Bearer ${trainerToken}`)
      .send({
        title: 'Draft Test Course',
        location: 'Draft City',
        category: 'SAFETY',
        contractType: 'Part-time',
        description: 'Testing draft course creation',
        price: 125,
        currency: 'USD',
        courseType: 'INTERNAL',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.course.status).toBe('DRAFT');
    draftCourseId = res.body.data.course.id;
  });

  it('POST /api/courses/drafts - should allow saving draft without a long description', async () => {
    const res = await request(app)
      .post('/api/courses/drafts')
      .set('Authorization', `Bearer ${trainerToken}`)
      .send({
        title: 'Quick Draft Course',
        category: 'SAFETY',
        description: '',
        price: 0,
        courseType: 'INTERNAL',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.course.status).toBe('DRAFT');
    expect(res.body.data.course.description).toBe('');
  });

  it('PATCH /api/courses/:id/publish - should publish an owned draft course', async () => {
    const res = await request(app)
      .patch(`/api/courses/${draftCourseId}/publish`)
      .set('Authorization', `Bearer ${trainerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.course.status).toBe('ACTIVE');
  });

  it('PATCH /api/courses/:id/unpublish - should unpublish an active course', async () => {
    const res = await request(app)
      .patch(`/api/courses/${draftCourseId}/unpublish`)
      .set('Authorization', `Bearer ${trainerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.course.status).toBe('DRAFT');
  });

  it('GET /api/courses/my - should list trainer specific courses', async () => {
    const res = await request(app)
      .get('/api/courses/my')
      .set('Authorization', `Bearer ${trainerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.courses.length).toBeGreaterThan(0);
    expect(
      res.body.data.courses.map((course: { id: string }) => course.id),
    ).toContain(courseId);
  });

  it('POST /api/courses/:courseId/sessions - should create a session', async () => {
    const res = await request(app)
      .post(`/api/courses/${courseId}/sessions`)
      .set('Authorization', `Bearer ${trainerToken}`)
      .send({
        startDate: new Date(Date.now() + 86400000).toISOString(),
        endDate: new Date(Date.now() + 172800000).toISOString(),
        startTime: '10:00',
        endTime: '18:00',
        location: 'Room 101',
        instructor: 'Dr. Test',
        totalSeats: 25,
      });

    expect(res.status).toBe(201);
    expect(res.body.data.session).toBeDefined();
    sessionId = res.body.data.session.id;
  });

  it('GET /api/courses/:courseId/sessions - should list sessions', async () => {
    const res = await request(app).get(`/api/courses/${courseId}/sessions`);

    expect(res.status).toBe(200);
    expect(res.body.data.sessions.length).toBeGreaterThan(0);
  });

  it('GET /api/courses/sessions/:id - should get session details', async () => {
    const res = await request(app).get(`/api/courses/sessions/${sessionId}`);

    expect(res.status).toBe(200);
    expect(res.body.data.session.id).toBe(sessionId);
  });

  it('PATCH /api/courses/sessions/:id - should update a session', async () => {
    const res = await request(app)
      .patch(`/api/courses/sessions/${sessionId}`)
      .set('Authorization', `Bearer ${trainerToken}`)
      .send({
        location: 'Updated Room',
        totalSeats: 30,
      });

    expect(res.status).toBe(200);
    expect(res.body.data.session.location).toBe('Updated Room');
  });

  it('DELETE /api/courses/sessions/:id - should delete a session', async () => {
    const res = await request(app)
      .delete(`/api/courses/sessions/${sessionId}`)
      .set('Authorization', `Bearer ${trainerToken}`);

    expect(res.status).toBe(204);

    const check = await prisma.courseSession.findUnique({
      where: { id: sessionId },
    });
    expect(check).toBeNull();
  });
});
