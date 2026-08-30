import request from 'supertest';
import app from '../app.js';
import { prisma } from '../config/prisma.js';
import bcrypt from 'bcryptjs';

describe('Admin External Jobs (scraped listings) Management', () => {
  let adminToken: string;
  let adminId: string;
  const testRunId = Date.now();
  const listingIds: string[] = [];

  const makeListing = (
    idSuffix: string,
    overrides: Partial<{
      title: string;
      company: string;
      provider: string;
      hiddenByAdmin: boolean;
    }> = {},
  ) => {
    const id = `test:${testRunId}:${idSuffix}`;
    listingIds.push(id);
    return prisma.externalJobListing.create({
      data: {
        id,
        title: overrides.title ?? `Test Scraped Job ${idSuffix}`,
        company: overrides.company ?? 'Suspicious Shipping Co',
        location: 'International Waters',
        description: 'A test scraped listing for admin moderation tests.',
        provider: overrides.provider ?? 'serpapi',
        fetchedAt: new Date(),
        hiddenByAdmin: overrides.hiddenByAdmin ?? false,
      },
    });
  };

  beforeAll(async () => {
    const testAdminEmail = `admin_extjobs_${testRunId}@maritime.com`;
    const hashedPassword = await bcrypt.hash('AdminSecret123!', 12);
    const admin = await prisma.admin.create({
      data: { email: testAdminEmail, password: hashedPassword },
    });
    adminId = admin.id;

    const loginRes = await request(app).post('/api/admin/login').send({
      email: testAdminEmail,
      password: 'AdminSecret123!',
    });
    adminToken = loginRes.body.token;

    await makeListing('a', { title: `Findable Scam Job ${testRunId}` });
    await makeListing('b', {
      title: `Another Listing ${testRunId}`,
      provider: 'jsearch',
    });
    await makeListing('c', {
      title: `Already Hidden ${testRunId}`,
      hiddenByAdmin: true,
    });
  });

  afterAll(async () => {
    await prisma.externalJobListing
      .deleteMany({ where: { id: { in: listingIds } } })
      .catch(() => {});
    await prisma.activityLog
      .deleteMany({ where: { actorId: adminId } })
      .catch(() => {});
    await prisma.admin.delete({ where: { id: adminId } }).catch(() => {});
    await prisma.$disconnect();
  });

  describe('GET /api/admin/external-jobs', () => {
    it('requires admin auth', async () => {
      const res = await request(app).get('/api/admin/external-jobs');
      expect(res.status).toBe(401);
    });

    it('finds a specific test listing by search, and excludes the pre-hidden one', async () => {
      const res = await request(app)
        .get('/api/admin/external-jobs')
        .query({ search: `Findable Scam Job ${testRunId}` })
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.listings).toHaveLength(1);
      expect(res.body.data.listings[0].title).toBe(
        `Findable Scam Job ${testRunId}`,
      );
    });

    it('never returns a listing already marked hiddenByAdmin', async () => {
      const res = await request(app)
        .get('/api/admin/external-jobs')
        .query({ search: `Already Hidden ${testRunId}` })
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.listings).toHaveLength(0);
    });

    it('filters by provider', async () => {
      const res = await request(app)
        .get('/api/admin/external-jobs')
        .query({ search: `Another Listing ${testRunId}`, provider: 'serpapi' })
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.listings).toHaveLength(0);
    });
  });

  describe('DELETE /api/admin/external-jobs/:id', () => {
    it('requires admin auth', async () => {
      const res = await request(app).delete(
        `/api/admin/external-jobs/test:${testRunId}:a`,
      );
      expect(res.status).toBe(401);
    });

    it('returns 404 for a listing that does not exist', async () => {
      const res = await request(app)
        .delete('/api/admin/external-jobs/does-not-exist')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
    });

    it('soft-hides the listing, logs the action, and it stops appearing in admin search', async () => {
      const id = `test:${testRunId}:a`;

      const deleteRes = await request(app)
        .delete(`/api/admin/external-jobs/${id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(deleteRes.status).toBe(200);

      const row = await prisma.externalJobListing.findUnique({ where: { id } });
      expect(row?.hiddenByAdmin).toBe(true);
      expect(row?.hiddenByAdminId).toBe(adminId);
      expect(row?.hiddenAt).not.toBeNull();

      const searchRes = await request(app)
        .get('/api/admin/external-jobs')
        .query({ search: `Findable Scam Job ${testRunId}` })
        .set('Authorization', `Bearer ${adminToken}`);
      expect(searchRes.body.data.listings).toHaveLength(0);

      const log = await prisma.activityLog.findFirst({
        where: {
          actorId: adminId,
          action: 'EXTERNAL_JOB_REMOVED',
          targetId: id,
        },
      });
      expect(log).not.toBeNull();
    });

    it('is idempotent — deleting an already-hidden listing succeeds without error', async () => {
      const id = `test:${testRunId}:a`;

      const res = await request(app)
        .delete(`/api/admin/external-jobs/${id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
    });

    it('a re-fetch by the same source id (simulated refresh upsert) does not un-hide it', async () => {
      const id = `test:${testRunId}:a`;

      // Mirrors refresh.ts's upsert `update` payload exactly — hiddenByAdmin
      // is deliberately absent from it, which is the whole point.
      await prisma.externalJobListing.update({
        where: { id },
        data: {
          title: `Findable Scam Job ${testRunId}`,
          company: 'Suspicious Shipping Co',
          location: 'International Waters',
          description: 'Re-fetched by a simulated daily refresh.',
          fetchedAt: new Date(),
        },
      });

      const row = await prisma.externalJobListing.findUnique({ where: { id } });
      expect(row?.hiddenByAdmin).toBe(true);
    });
  });
});
