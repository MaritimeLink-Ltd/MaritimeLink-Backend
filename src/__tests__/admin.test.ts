import request from 'supertest';
import app from '../app.js';
import { prisma } from '../config/prisma.js';
import bcrypt from 'bcryptjs';

describe('Admin Flow E2E Tests', () => {
  let adminId: string;
  let adminToken: string;
  const testAdminEmail = `admin_${Date.now()}@maritime.com`;
  const testAdminPassword = 'AdminSecret123!';

  beforeAll(async () => {
    // Create a test admin
    const hashedPassword = await bcrypt.hash(testAdminPassword, 12);
    const admin = await prisma.admin.create({
      data: {
        email: testAdminEmail,
        password: hashedPassword,
      },
    });
    adminId = admin.id;
  });

  afterAll(async () => {
    // Cleanup
    if (adminId) {
      await prisma.admin.delete({ where: { id: adminId } }).catch(() => {});
    }
    await prisma.$disconnect();
  });

  describe('Admin Authentication', () => {
    it('Step 1: should login with admin credentials', async () => {
      const res = await request(app).post('/api/admin/login').send({
        email: testAdminEmail,
        password: testAdminPassword,
      });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.token).toBeDefined();
      adminToken = res.body.token;
    });

    it('should return 401 for invalid credentials', async () => {
      const res = await request(app).post('/api/admin/login').send({
        email: testAdminEmail,
        password: 'wrongpassword',
      });

      expect(res.status).toBe(401);
    });
  });

  describe('Admin Dashboard', () => {
    it('Step 2: should retrieve main dashboard stats', async () => {
      const res = await request(app)
        .get('/api/admin/dashboard/stats')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.data.stats).toHaveProperty('pendingApprovals');
      expect(res.body.data.stats).toHaveProperty('flaggedIssues');
    });

    it('Step 3: should retrieve platform activity overview', async () => {
      const res = await request(app)
        .get('/api/admin/dashboard/activity')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.data.activity).toHaveProperty('jobsPosted');
      expect(res.body.data.userBreakdown).toHaveProperty('recruiters');
    });

    it('Step 4: should retrieve revenue and financial overview', async () => {
      const res = await request(app)
        .get('/api/admin/dashboard/revenue')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.data.overview).toHaveProperty('totalRevenue');
    });

    it('Step 5: should retrieve admin action queues', async () => {
      const res = await request(app)
        .get('/api/admin/dashboard/queues')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(Array.isArray(res.body.data.reviewQueue)).toBe(true);
      expect(Array.isArray(res.body.data.systemAlerts)).toBe(true);
    });
  });

  describe('Admin Operations', () => {
    it('should retrieve system activity logs', async () => {
      const res = await request(app)
        .get('/api/admin/operations/activity')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.data).toHaveProperty('logs');
    });

    it('should retrieve system performance stats', async () => {
      const res = await request(app)
        .get('/api/admin/operations/stats')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.data).toHaveProperty('activeUsers');
    });
  });
});
