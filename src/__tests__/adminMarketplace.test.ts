import request from 'supertest';
import app from '../app.js';
import { prisma } from '../config/prisma.js';
import bcrypt from 'bcryptjs';

describe('Admin Marketplace Management Tests', () => {
  let adminToken: string;
  let recruiterId: string;
  let adminId: string;

  beforeAll(async () => {
    // 1. Create a test admin
    const testAdminEmail = `admin_mkt_${Date.now()}@maritime.com`;
    const hashedPassword = await bcrypt.hash('AdminSecret123!', 12);
    const admin = await prisma.admin.create({
      data: {
        email: testAdminEmail,
        password: hashedPassword,
      },
    });
    adminId = admin.id;

    // Login to get token
    const loginRes = await request(app).post('/api/admin/login').send({
      email: testAdminEmail,
      password: 'AdminSecret123!',
    });
    adminToken = loginRes.body.token;

    // 2. Create a test recruiter
    const recruiter = await prisma.recruiter.create({
      data: {
        email: `rec_mkt_${Date.now()}@maritime.com`,
        password: hashedPassword,
        role: 'RECRUITMENT_AGENT',
        status: 'APPROVED',
      },
    });
    recruiterId = recruiter.id;

    // 3. Create a test job
    await prisma.job.create({
      data: {
        title: 'Test Job for Admin Filtering',
        location: 'London',
        category: 'OFFICER',
        contractType: 'PERMANENT',
        salary: '50000',
        description: 'Test Description',
        recruiterId: recruiterId,
        status: 'ACTIVE',
      },
    });

    // 4. Create a test course
    await prisma.course.create({
      data: {
        title: 'Test Course for Admin Filtering',
        location: 'London',
        category: 'Safety',
        price: 500,
        description: 'Test Description',
        recruiterId: recruiterId,
        status: 'ACTIVE',
      },
    });
  });

  afterAll(async () => {
    // Cleanup
    await prisma.job.deleteMany({ where: { recruiterId } }).catch(() => {});
    await prisma.course.deleteMany({ where: { recruiterId } }).catch(() => {});
    await prisma.recruiter
      .delete({ where: { id: recruiterId } })
      .catch(() => {});
    await prisma.admin.delete({ where: { id: adminId } }).catch(() => {});
    await prisma.$disconnect();
  });

  describe('Jobs Filtering', () => {
    it('should return all jobs for admin', async () => {
      const res = await request(app)
        .get('/api/admin/jobs')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(Array.isArray(res.body.data.jobs)).toBe(true);
      expect(res.body.data.jobs.length).toBeGreaterThan(0);
    });

    it('should filter jobs by recruiterId', async () => {
      const res = await request(app)
        .get(`/api/admin/jobs?recruiterId=${recruiterId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(
        res.body.data.jobs.every(
          (j: { recruiterId: string }) => j.recruiterId === recruiterId,
        ),
      ).toBe(true);
      expect(res.body.data.jobs.length).toBeGreaterThan(0);
    });
  });

  describe('Courses Filtering', () => {
    it('should return all courses for admin', async () => {
      const res = await request(app)
        .get('/api/admin/courses')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(Array.isArray(res.body.data.courses)).toBe(true);
      expect(res.body.data.courses.length).toBeGreaterThan(0);
    });

    it('should filter courses by recruiterId', async () => {
      const res = await request(app)
        .get(`/api/admin/courses?recruiterId=${recruiterId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(
        res.body.data.courses.every(
          (c: { recruiterId: string }) => c.recruiterId === recruiterId,
        ),
      ).toBe(true);
      expect(res.body.data.courses.length).toBeGreaterThan(0);
    });
  });
  describe('Bulk Job Upload', () => {
    it('should return a sample CSV format', async () => {
      const res = await request(app)
        .get('/api/admin/jobs/bulk-upload/sample')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.header['content-type']).toContain('text/csv');
      expect(res.text).toContain(
        'title,location,category,contractType,salary,description',
      );
    });

    it('should successfully bulk upload jobs via CSV', async () => {
      const csvContent =
        'title,location,category,contractType,salary,description\nBulk Job 1,London,OFFICER,PERMANENT,60000,Bulk Description 1\nBulk Job 2,Dubai,RATINGS_AND_CREW,CONTRACT,40000,Bulk Description 2';

      const res = await request(app)
        .post('/api/admin/jobs/bulk-upload')
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('file', Buffer.from(csvContent), 'test_jobs.csv');

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('success');
      expect(res.body.count).toBe(2);

      // Verify the jobs were actually created
      const dbJobs = await prisma.job.findMany({
        where: { title: { startsWith: 'Bulk Job' } },
      });
      expect(dbJobs.length).toBe(2);
      expect(dbJobs[0].adminId).toBe(adminId);
    });

    it('should fail if no file is uploaded', async () => {
      const res = await request(app)
        .post('/api/admin/jobs/bulk-upload')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Please upload a CSV file');
    });
  });
});
