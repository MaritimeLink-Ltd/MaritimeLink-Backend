import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import app from '../app.js';
import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';

/**
 * Admin team management: super admins invite collaborators with a role,
 * Operations Managers run the platform without seeing money or managing the
 * team, invitations are single-use and expire, and deactivated admins lose
 * access immediately.
 */

const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const password = 'Password123!';
const sign = (payload: object) =>
  jwt.sign(payload, env.JWT_SECRET, { expiresIn: '1h' });
const adminIds: string[] = [];
const professionalIds: string[] = [];
const recruiterIds: string[] = [];
const invitedEmails: string[] = [];

const createAdmin = async (
  role: 'SUPER_ADMIN' | 'OPERATIONS_MANAGER',
  label: string,
) => {
  const admin = await prisma.admin.create({
    data: {
      email: `team-${label}-${suffix}@example.com`,
      password: await bcrypt.hash(password, 4),
      role,
    },
  });
  adminIds.push(admin.id);
  return { admin, auth: `Bearer ${sign({ id: admin.id, role })}` };
};

/** Invitation row with a known raw token (the email itself isn't read here). */
const createInvitation = async (
  invitedById: string,
  role: 'SUPER_ADMIN' | 'OPERATIONS_MANAGER',
  overrides: Record<string, unknown> = {},
) => {
  const token = crypto.randomBytes(32).toString('hex');
  const email = `invitee-${suffix}-${Math.floor(Math.random() * 1e6)}@example.com`;
  invitedEmails.push(email);
  await prisma.adminInvitation.create({
    data: {
      email,
      role,
      tokenHash: crypto.createHash('sha256').update(token).digest('hex'),
      invitedById,
      expiresAt: new Date(Date.now() + 72 * 3600 * 1000),
      ...overrides,
    },
  });
  return { token, email };
};

let superAdmin: Awaited<ReturnType<typeof createAdmin>>;
let opsManager: Awaited<ReturnType<typeof createAdmin>>;

beforeAll(async () => {
  superAdmin = await createAdmin('SUPER_ADMIN', 'super');
  opsManager = await createAdmin('OPERATIONS_MANAGER', 'ops');
});

afterAll(async () => {
  await prisma.adminInvitation.deleteMany({
    where: {
      OR: [{ email: { in: invitedEmails } }, { invitedById: { in: adminIds } }],
    },
  });
  const accepted = await prisma.admin.findMany({
    where: { email: { in: invitedEmails } },
    select: { id: true },
  });
  await prisma.course.deleteMany({
    where: { recruiterId: { in: recruiterIds } },
  });
  await prisma.professional.deleteMany({
    where: { id: { in: professionalIds } },
  });
  await prisma.recruiter.deleteMany({ where: { id: { in: recruiterIds } } });
  await prisma.admin.deleteMany({
    where: { id: { in: [...adminIds, ...accepted.map((a) => a.id)] } },
  });
  await prisma.$disconnect();
});

describe('Team management is for super admins only', () => {
  it('super admin sees the team and can invite an Operations Manager', async () => {
    const team = await request(app)
      .get('/api/admin/team')
      .set('Authorization', superAdmin.auth);
    expect(team.status).toBe(200);
    expect(Array.isArray(team.body.data.members)).toBe(true);
    expect(
      team.body.data.invitableRoles.map((r: { value: string }) => r.value),
    ).toEqual(['SUPER_ADMIN', 'OPERATIONS_MANAGER']);

    const email = `new-ops-${suffix}@example.com`;
    invitedEmails.push(email);
    const invite = await request(app)
      .post('/api/admin/team/invitations')
      .set('Authorization', superAdmin.auth)
      .send({ email, role: 'OPERATIONS_MANAGER' });
    expect(invite.status).toBe(201);
    expect(invite.body.data.invitation.status).toBe('PENDING');

    const row = await prisma.adminInvitation.findFirst({ where: { email } });
    expect(row?.tokenHash).toMatch(/^[a-f0-9]{64}$/); // only a hash is stored
  });

  it('cannot invite someone who is already an active admin, or with an unknown role', async () => {
    const dup = await request(app)
      .post('/api/admin/team/invitations')
      .set('Authorization', superAdmin.auth)
      .send({ email: opsManager.admin.email, role: 'OPERATIONS_MANAGER' });
    expect(dup.status).toBe(409);

    const badRole = await request(app)
      .post('/api/admin/team/invitations')
      .set('Authorization', superAdmin.auth)
      .send({ email: `x-${suffix}@example.com`, role: 'ADMIN' });
    expect(badRole.status).toBe(400);
  });

  it('an Operations Manager cannot view or change the team', async () => {
    const team = await request(app)
      .get('/api/admin/team')
      .set('Authorization', opsManager.auth);
    expect(team.status).toBe(403);
    const invite = await request(app)
      .post('/api/admin/team/invitations')
      .set('Authorization', opsManager.auth)
      .send({ email: `sneaky-${suffix}@example.com`, role: 'SUPER_ADMIN' });
    expect(invite.status).toBe(403);
    const promote = await request(app)
      .patch(`/api/admin/team/members/${opsManager.admin.id}`)
      .set('Authorization', opsManager.auth)
      .send({ role: 'SUPER_ADMIN' });
    expect(promote.status).toBe(403);
  });
});

describe('Operations Manager and money', () => {
  it('is refused every purely financial endpoint', async () => {
    for (const path of [
      '/api/admin/dashboard/revenue',
      '/api/admin/dashboard/transactions',
      '/api/admin/revenue',
      '/api/admin/trainers/payout-stats',
    ]) {
      const res = await request(app)
        .get(path)
        .set('Authorization', opsManager.auth);
      expect(res.status).toBe(403);
    }
    const allowed = await request(app)
      .get('/api/admin/dashboard/revenue')
      .set('Authorization', superAdmin.auth);
    expect(allowed.status).toBe(200);
  });

  it('can still use the rest of the admin panel', async () => {
    for (const path of [
      '/api/admin/dashboard/stats',
      '/api/admin/professionals',
      '/api/admin/settings',
    ]) {
      const res = await request(app)
        .get(path)
        .set('Authorization', opsManager.auth);
      expect(res.status).toBe(200);
    }
    const settings = await request(app)
      .get('/api/admin/settings')
      .set('Authorization', opsManager.auth);
    expect(settings.body.data.profile.role).toBe('OPERATIONS_MANAGER');
    expect(settings.body.data.profile.permissions).toEqual({
      canManageTeam: false,
      canViewFinancials: false,
    });
  });

  it('sees bookings without amounts; a super admin sees the amounts', async () => {
    const trainer = await prisma.recruiter.create({
      data: {
        email: `team-trainer-${suffix}@example.com`,
        password: await bcrypt.hash(password, 4),
        role: 'TRAINING_AGENT',
        isVerified: true,
        status: 'APPROVED',
      },
    });
    recruiterIds.push(trainer.id);
    const pro = await prisma.professional.create({
      data: {
        fullname: 'Team Booker',
        email: `team-booker-${suffix}@example.com`,
        password: await bcrypt.hash(password, 4),
        isVerified: true,
        status: 'VERIFIED',
        registrationStep: 5,
      },
    });
    professionalIds.push(pro.id);
    const course = await prisma.course.create({
      data: {
        title: 'Team course',
        category: 'Safety',
        description: 'Course',
        price: 250,
        recruiterId: trainer.id,
      },
    });
    await prisma.courseBooking.create({
      data: {
        professionalId: pro.id,
        courseId: course.id,
        amountPaid: 250,
        currency: 'GBP',
        bookingStatus: 'CONFIRMED',
        paymentStatus: 'SUCCEEDED',
        platformFee: 25,
        trainerPayout: 225,
      },
    });

    const asOps = await request(app)
      .get(`/api/admin/professionals/${pro.id}`)
      .set('Authorization', opsManager.auth);
    expect(asOps.status).toBe(200);
    const opsBody = JSON.stringify(asOps.body);
    expect(opsBody).not.toContain('amountPaid');
    expect(opsBody).not.toContain('platformFee');
    expect(opsBody).not.toContain('trainerPayout');
    expect(opsBody).toContain('Team course'); // the booking itself is still there

    const asSuper = await request(app)
      .get(`/api/admin/professionals/${pro.id}`)
      .set('Authorization', superAdmin.auth);
    expect(JSON.stringify(asSuper.body)).toContain('amountPaid');
  });

  it('public course session lists no longer reveal takings', async () => {
    const trainer = await prisma.recruiter.create({
      data: {
        email: `team-trainer2-${suffix}@example.com`,
        password: await bcrypt.hash(password, 4),
        role: 'TRAINING_AGENT',
        isVerified: true,
        status: 'APPROVED',
      },
    });
    recruiterIds.push(trainer.id);
    const course = await prisma.course.create({
      data: {
        title: 'Session revenue course',
        category: 'Safety',
        description: 'Course',
        price: 100,
        recruiterId: trainer.id,
        sessions: {
          create: {
            startDate: new Date(Date.now() + 86400000 * 3),
            endDate: new Date(Date.now() + 86400000 * 4),
            location: 'Hull',
            totalSeats: 5,
            availableSeats: 5,
          },
        },
      },
    });
    const anon = await request(app).get(`/api/courses/${course.id}/sessions`);
    expect(anon.status).toBe(200);
    expect(anon.body.data.sessions[0].revenue).toBeUndefined();

    const owner = await request(app)
      .get(`/api/courses/${course.id}/sessions`)
      .set(
        'Authorization',
        `Bearer ${sign({ id: trainer.id, role: trainer.role })}`,
      );
    expect(owner.body.data.sessions[0].revenue).toBe(0);

    const ops = await request(app)
      .get(`/api/courses/${course.id}/sessions`)
      .set('Authorization', opsManager.auth);
    expect(ops.body.data.sessions[0].revenue).toBeUndefined();

    const sup = await request(app)
      .get(`/api/courses/${course.id}/sessions`)
      .set('Authorization', superAdmin.auth);
    expect(sup.body.data.sessions[0].revenue).toBe(0);
  });
});

describe('Accepting an invitation', () => {
  it('shows the invitation, rejects weak passwords, then creates the account once', async () => {
    const { token, email } = await createInvitation(
      superAdmin.admin.id,
      'OPERATIONS_MANAGER',
    );

    const details = await request(app).get(`/api/admin/invitations/${token}`);
    expect(details.status).toBe(200);
    expect(details.body.data.invitation).toMatchObject({
      email,
      role: 'OPERATIONS_MANAGER',
      roleLabel: 'Operations Manager',
    });

    const weak = await request(app)
      .post(`/api/admin/invitations/${token}/accept`)
      .send({ password: 'short' });
    expect(weak.status).toBe(400);

    const accepted = await request(app)
      .post(`/api/admin/invitations/${token}/accept`)
      .send({ password: 'Strong-pass-123', name: 'Olivia Ops' });
    expect(accepted.status).toBe(201);
    expect(typeof accepted.body.token).toBe('string');
    expect(accepted.body.data.user.role).toBe('OPERATIONS_MANAGER');
    expect(accepted.body.data.user.permissions.canViewFinancials).toBe(false);
    expect(accepted.body.data.user.permissions.canManageTeam).toBe(false);
    expect(accepted.body.data.user.name).toBe('Olivia Ops');

    const reuse = await request(app)
      .post(`/api/admin/invitations/${token}/accept`)
      .send({ password: 'Another-pass-123' });
    expect(reuse.status).toBe(410);

    const login = await request(app)
      .post('/api/admin/login')
      .send({ email, password: 'Strong-pass-123' });
    expect(login.status).toBe(200);
    expect(login.body.data.user.role).toBe('OPERATIONS_MANAGER');
  });

  it('refuses expired, cancelled and made-up links', async () => {
    const expired = await createInvitation(superAdmin.admin.id, 'SUPER_ADMIN', {
      expiresAt: new Date(Date.now() - 1000),
    });
    const res = await request(app)
      .post(`/api/admin/invitations/${expired.token}/accept`)
      .send({ password: 'Strong-pass-123' });
    expect(res.status).toBe(410);
    expect(res.body.code).toBe('INVITATION_EXPIRED');

    const cancelled = await createInvitation(
      superAdmin.admin.id,
      'SUPER_ADMIN',
      { revokedAt: new Date() },
    );
    expect(
      (await request(app).get(`/api/admin/invitations/${cancelled.token}`))
        .status,
    ).toBe(410);

    const fake = crypto.randomBytes(32).toString('hex');
    expect(
      (await request(app).get(`/api/admin/invitations/${fake}`)).status,
    ).toBe(410);
  });

  it('a newer invitation replaces the older one for the same email', async () => {
    const email = `reinvite-${suffix}@example.com`;
    invitedEmails.push(email);
    await request(app)
      .post('/api/admin/team/invitations')
      .set('Authorization', superAdmin.auth)
      .send({ email, role: 'OPERATIONS_MANAGER' });
    await request(app)
      .post('/api/admin/team/invitations')
      .set('Authorization', superAdmin.auth)
      .send({ email, role: 'SUPER_ADMIN' });
    const open = await prisma.adminInvitation.findMany({
      where: { email, acceptedAt: null, revokedAt: null },
    });
    expect(open).toHaveLength(1);
    expect(open[0].role).toBe('SUPER_ADMIN');
  });
});

describe('Changing roles and removing people', () => {
  it('deactivating someone cuts their access at once; reactivating restores it', async () => {
    const member = await createAdmin('OPERATIONS_MANAGER', 'leaver');

    const off = await request(app)
      .post(`/api/admin/team/members/${member.admin.id}/deactivate`)
      .set('Authorization', superAdmin.auth);
    expect(off.status).toBe(200);

    const blocked = await request(app)
      .get('/api/admin/dashboard/stats')
      .set('Authorization', member.auth);
    expect(blocked.status).toBe(403);
    // The website signs the person out when it sees this code.
    expect(blocked.body.code).toBe('ADMIN_ACCOUNT_DISABLED');
    const login = await request(app)
      .post('/api/admin/login')
      .send({ email: member.admin.email, password });
    expect(login.status).toBe(403);

    const on = await request(app)
      .post(`/api/admin/team/members/${member.admin.id}/reactivate`)
      .set('Authorization', superAdmin.auth);
    expect(on.status).toBe(200);
    const back = await request(app)
      .get('/api/admin/dashboard/stats')
      .set('Authorization', member.auth);
    expect(back.status).toBe(200);
  });

  it('a super admin cannot deactivate or demote themselves', async () => {
    const self = await request(app)
      .post(`/api/admin/team/members/${superAdmin.admin.id}/deactivate`)
      .set('Authorization', superAdmin.auth);
    expect(self.status).toBe(400);
    const demote = await request(app)
      .patch(`/api/admin/team/members/${superAdmin.admin.id}`)
      .set('Authorization', superAdmin.auth)
      .send({ role: 'OPERATIONS_MANAGER' });
    expect(demote.status).toBe(400);
  });

  it('promoting an Operations Manager takes effect on their next request', async () => {
    const member = await createAdmin('OPERATIONS_MANAGER', 'promoted');
    expect(
      (
        await request(app)
          .get('/api/admin/dashboard/revenue')
          .set('Authorization', member.auth)
      ).status,
    ).toBe(403);
    const promote = await request(app)
      .patch(`/api/admin/team/members/${member.admin.id}`)
      .set('Authorization', superAdmin.auth)
      .send({ role: 'SUPER_ADMIN' });
    expect(promote.status).toBe(200);
    // Same (old) token — the role is read from the database on every request.
    expect(
      (
        await request(app)
          .get('/api/admin/dashboard/revenue')
          .set('Authorization', member.auth)
      ).status,
    ).toBe(200);
  });
});
