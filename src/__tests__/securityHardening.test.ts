import { jest } from '@jest/globals';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import { io as ioClient, Socket } from 'socket.io-client';
import app from '../app.js';
import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import { setupSocket } from '../socket/index.js';
import { stripeService } from '../services/stripeService.js';
import {
  isPrivateAddress,
  isPublicHttpUrl,
  fetchStoredFile,
} from '../utils/storedFileFetch.js';
import { storagePathBelongsTo } from '../middlewares/responseSafety.js';
import { parseStorageUrl } from '../services/storageUrlService.js';

/**
 * Regression tests for the security fixes. Each block exercises the real
 * HTTP endpoints against the database configured for the test run.
 */

const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const password = 'Password123!';
const sign = (payload: object, opts: jwt.SignOptions = { expiresIn: '1h' }) =>
  jwt.sign(payload, env.JWT_SECRET, opts);

const createdProfessionalIds: string[] = [];
const createdRecruiterIds: string[] = [];

const createProfessional = async (
  overrides: Record<string, unknown> = {},
  label = 'p',
) => {
  const professional = await prisma.professional.create({
    data: {
      firstName: 'Test',
      lastName: label,
      fullname: `Test ${label}`,
      email: `sec-${label}-${suffix}-${Math.floor(Math.random() * 1e6)}@example.com`,
      password: await bcrypt.hash(password, 4),
      isVerified: true,
      status: 'VERIFIED',
      registrationStep: 5,
      ...overrides,
    },
  });
  createdProfessionalIds.push(professional.id);
  return professional;
};

const createRecruiter = async (
  overrides: Record<string, unknown> = {},
  label = 'r',
) => {
  const recruiter = await prisma.recruiter.create({
    data: {
      email: `sec-${label}-${suffix}-${Math.floor(Math.random() * 1e6)}@example.com`,
      password: await bcrypt.hash(password, 4),
      role: 'RECRUITMENT_AGENT',
      isVerified: true,
      status: 'APPROVED',
      registrationStep: 6,
      ...overrides,
    },
  });
  createdRecruiterIds.push(recruiter.id);
  return recruiter;
};

const findKey = (value: unknown, key: string): boolean => {
  if (Array.isArray(value)) return value.some((v) => findKey(v, key));
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).some(
      ([k, v]) => k === key || findKey(v, key),
    );
  }
  return false;
};

afterAll(async () => {
  await prisma.professional.deleteMany({
    where: { id: { in: createdProfessionalIds } },
  });
  await prisma.course.deleteMany({
    where: { recruiterId: { in: createdRecruiterIds } },
  });
  await prisma.recruiter.deleteMany({
    where: { id: { in: createdRecruiterIds } },
  });
  await prisma.$disconnect();
});

describe('Signup steps can no longer be replayed against finished accounts', () => {
  it('refuses /role for a completed professional (no token)', async () => {
    const victim = await createProfessional({}, 'victim');
    const res = await request(app)
      .patch('/api/professional/role')
      .send({ professionalId: victim.id, subcategory: 'Master' });
    expect(res.status).toBe(403);
    expect(res.body.token).toBeUndefined();
    const after = await prisma.professional.findUnique({
      where: { id: victim.id },
    });
    expect(after?.subcategory).toBeNull();
  });

  it('refuses /profession, /complete-profile and /upload-photo for a completed professional', async () => {
    const victim = await createProfessional({}, 'victim2');
    const profession = await request(app)
      .patch('/api/professional/profession')
      .send({ professionalId: victim.id, profession: 'OFFICER' });
    expect(profession.status).toBe(403);

    const complete = await request(app)
      .post('/api/professional/complete-profile')
      .send({
        professionalId: victim.id,
        profession: 'OFFICER',
        bio: 'Experienced officer',
        idPassportUrl: 'https://example.com/attacker-id.png',
      });
    expect(complete.status).toBe(403);
    expect(complete.body.token).toBeUndefined();

    const photo = await request(app)
      .post('/api/professional/upload-photo')
      .field('professionalId', victim.id)
      .attach('photo', Buffer.from('fake-image'), 'p.png');
    expect(photo.status).toBe(403);
  });

  it('still lets a professional finish their own signup (mid-signup, verified)', async () => {
    const newcomer = await createProfessional(
      { status: 'PENDING', registrationStep: 2 },
      'newcomer',
    );
    const profession = await request(app)
      .patch('/api/professional/profession')
      .send({ professionalId: newcomer.id, profession: 'OFFICER' });
    expect(profession.status).toBe(200);

    const role = await request(app)
      .patch('/api/professional/role')
      .send({ professionalId: newcomer.id, subcategory: 'Master' });
    expect(role.status).toBe(200);
    expect(typeof role.body.token).toBe('string');

    // Finished now — replaying the step is refused.
    const replay = await request(app)
      .patch('/api/professional/role')
      .send({ professionalId: newcomer.id, subcategory: 'Chief Officer' });
    expect(replay.status).toBe(403);
  });

  it('requires the email to be verified before the wizard steps', async () => {
    const unverified = await createProfessional(
      { status: 'PENDING', registrationStep: 1, isVerified: false },
      'unverified',
    );
    const role = await request(app)
      .patch('/api/professional/role')
      .send({ professionalId: unverified.id, subcategory: 'Master' });
    expect(role.status).toBe(403);
    expect(role.body.token).toBeUndefined();
  });

  it('a finished account cannot use the wizard even with its own token', async () => {
    const owner = await createProfessional({}, 'owner');
    const res = await request(app)
      .patch('/api/professional/profession')
      .set('Authorization', `Bearer ${sign({ id: owner.id })}`)
      .send({ professionalId: owner.id, profession: 'OFFICER' });
    expect(res.status).toBe(403);
  });

  it('an approved recruiter cannot re-run company details (self-verification) with its own token', async () => {
    const recruiter = await createRecruiter({}, 'selfverify');
    const res = await request(app)
      .patch('/api/recruiter/company-details')
      .set(
        'Authorization',
        `Bearer ${sign({ id: recruiter.id, role: recruiter.role })}`,
      )
      .send({
        recruiterId: recruiter.id,
        organizationName: 'Renamed Ltd',
        address: '1 Road',
        companyCity: 'London',
        companyState: 'London',
        companyZip: 'E1',
        companyCountry: 'UK',
        organizationVerified: true,
      });
    expect(res.status).toBe(403);
  });

  it('a token for a different account does not unlock someone else', async () => {
    const victim = await createProfessional({}, 'victim3');
    const attacker = await createProfessional({}, 'attacker');
    const res = await request(app)
      .patch('/api/professional/role')
      .set('Authorization', `Bearer ${sign({ id: attacker.id })}`)
      .send({ professionalId: victim.id, subcategory: 'Master' });
    expect(res.status).toBe(403);
  });

  it('refuses recruiter /compliance and /company-details for an approved recruiter', async () => {
    const recruiter = await createRecruiter({}, 'approved');
    const compliance = await request(app)
      .patch('/api/recruiter/compliance')
      .send({
        recruiterId: recruiter.id,
        isAuthorized: true,
        agreedToTerms: true,
        howDidYouHear: 'Search',
      });
    expect(compliance.status).toBe(403);
    expect(compliance.body.token).toBeUndefined();
    const after = await prisma.recruiter.findUnique({
      where: { id: recruiter.id },
    });
    expect(after?.status).toBe('APPROVED');

    const personal = await request(app)
      .patch('/api/recruiter/personal-info')
      .send({
        recruiterId: recruiter.id,
        firstName: 'Evil',
        lastName: 'Person',
        phoneCode: '+44',
        phoneNumber: '7000000000',
        personalRole: 'Owner',
      });
    expect(personal.status).toBe(403);
  });

  it('still lets a recruiter finish their own signup', async () => {
    const recruiter = await createRecruiter(
      { status: 'PENDING', registrationStep: 5 },
      'signup',
    );
    const res = await request(app).patch('/api/recruiter/compliance').send({
      recruiterId: recruiter.id,
      isAuthorized: true,
      agreedToTerms: true,
      howDidYouHear: 'Search',
    });
    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');
  });

  it('legacy recruiter upload routes now need a login', async () => {
    const id = await request(app)
      .post('/api/recruiter/upload-id')
      .attach('id_passport', Buffer.from('x'), 'id.png');
    expect(id.status).toBe(401);
    const kyc = await request(app)
      .post('/api/recruiter/kyc/upload-document')
      .attach('document', Buffer.from('x'), 'doc.png');
    expect(kyc.status).toBe(401);
  });
});

describe('One-time codes', () => {
  it('rejects a missing code or a filter object instead of a code', async () => {
    const pro = await createProfessional(
      {
        status: 'PENDING',
        registrationStep: 1,
        isVerified: false,
        otpCode: '123456',
        otpExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
      'otp',
    );
    const missing = await request(app)
      .post('/api/professional/verify-otp')
      .send({ professionalId: pro.id });
    expect(missing.status).toBe(400);

    const filterObject = await request(app)
      .post('/api/professional/verify-otp')
      .send({ professionalId: pro.id, code: { not: '' } });
    expect(filterObject.status).toBe(400);

    const urlEncoded = await request(app)
      .post('/api/professional/verify-otp')
      .type('form')
      .send(`professionalId=${pro.id}&code[not]=x`);
    expect(urlEncoded.status).toBe(400);

    let after = await prisma.professional.findUnique({ where: { id: pro.id } });
    expect(after?.isVerified).toBe(false);

    const ok = await request(app)
      .post('/api/professional/verify-otp')
      .send({ professionalId: pro.id, code: '123456' });
    expect(ok.status).toBe(200);
    after = await prisma.professional.findUnique({ where: { id: pro.id } });
    expect(after?.isVerified).toBe(true);
  });

  it('rejects the same trick on recruiter email verification', async () => {
    const recruiter = await createRecruiter(
      {
        status: 'PENDING',
        registrationStep: 1,
        isVerified: false,
        otpCode: '654321',
        otpExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
      'otp',
    );
    const res = await request(app)
      .post('/api/recruiter/verify-otp')
      .send({ recruiterId: recruiter.id, code: { not: '' } });
    expect(res.status).toBe(400);
    const after = await prisma.recruiter.findUnique({
      where: { id: recruiter.id },
    });
    expect(after?.isVerified).toBe(false);
  });

  it('locks out repeated wrong codes for an account', async () => {
    const pro = await createProfessional(
      {
        status: 'PENDING',
        registrationStep: 1,
        isVerified: false,
        otpCode: '111111',
        otpExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
      'otp-brute',
    );
    const statuses: number[] = [];
    for (let i = 0; i < 11; i += 1) {
      const res = await request(app)
        .post('/api/professional/verify-otp')
        .send({ professionalId: pro.id, code: String(200000 + i) });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 400)).toBe(true);
    expect(statuses[10]).toBe(429);
    // Even the right code is refused while locked out.
    const right = await request(app)
      .post('/api/professional/verify-otp')
      .send({ professionalId: pro.id, code: '111111' });
    expect(right.status).toBe(429);
  });
});

describe('Login brute-force protection', () => {
  it('blocks after 10 wrong passwords for one account, without affecting others', async () => {
    const pro = await createProfessional({}, 'brute');
    const other = await createProfessional({}, 'bystander');
    for (let i = 0; i < 10; i += 1) {
      const res = await request(app)
        .post('/api/professional/login')
        .send({ email: pro.email, password: `wrong-${i}` });
      expect(res.status).toBe(401);
    }
    const blocked = await request(app)
      .post('/api/professional/login')
      .send({ email: pro.email, password });
    expect(blocked.status).toBe(429);
    expect(blocked.body.status).toBe('error');
    expect(typeof blocked.body.message).toBe('string');

    const unaffected = await request(app)
      .post('/api/professional/login')
      .send({ email: other.email, password });
    expect(unaffected.status).toBe(200);
  });

  it('successful logins are not counted', async () => {
    const pro = await createProfessional({}, 'frequent');
    for (let i = 0; i < 12; i += 1) {
      const res = await request(app)
        .post('/api/professional/login')
        .send({ email: pro.email, password });
      expect(res.status).toBe(200);
    }
  });
});

describe('Sessions', () => {
  it('a token signed with a different secret gets 401 INVALID_SESSION', async () => {
    const pro = await createProfessional({}, 'forged');
    const forged = jwt.sign({ id: pro.id }, 'your_secret_here');
    const res = await request(app)
      .get('/api/professional/me')
      .set('Authorization', `Bearer ${forged}`);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_SESSION');
  });

  it('an expired token gets 401 INVALID_SESSION (was a 500 before)', async () => {
    const pro = await createProfessional({}, 'expired');
    const expired = sign({ id: pro.id }, { expiresIn: -10 });
    const res = await request(app)
      .get('/api/professional/me')
      .set('Authorization', `Bearer ${expired}`);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_SESSION');
  });

  it('rejects alg=none tokens', async () => {
    const pro = await createProfessional({}, 'none');
    const unsigned = jwt.sign({ id: pro.id }, '', { algorithm: 'none' });
    const res = await request(app)
      .get('/api/professional/me')
      .set('Authorization', `Bearer ${unsigned}`);
    expect(res.status).toBe(401);
  });

  it('internal database errors are not echoed to the client', async () => {
    const res = await request(app).post('/api/professional/login').send({});
    expect(res.status).toBeGreaterThanOrEqual(400);
    // (Development mode additionally attaches the stack for debugging; the
    // message itself — what production sends — must not describe internals.)
    expect(res.body.message).not.toMatch(/prisma|invocation/i);
  });
});

describe('Account secrets never leave the API', () => {
  it('recruiter candidate profile has no password hash, OTP, reset token or passport link', async () => {
    const recruiter = await createRecruiter({ tier: 'PREMIUM' }, 'viewer');
    const pro = await createProfessional(
      {
        otpCode: '999999',
        passwordResetToken: 'hashed-reset-token',
        idPassportUrl: 'https://example.com/passport.png',
      },
      'candidate',
    );
    const res = await request(app)
      .get(`/api/recruiter/professionals/${pro.id}`)
      .set(
        'Authorization',
        `Bearer ${sign({ id: recruiter.id, role: recruiter.role })}`,
      );
    expect(res.status).toBe(200);
    for (const key of [
      'password',
      'otpCode',
      'passwordResetToken',
      'idPassportUrl',
    ]) {
      expect(findKey(res.body, key)).toBe(false);
    }
    // Normal profile fields are still there.
    expect(res.body.data.professional.id ?? res.body.data.id).toBeDefined();
  });
});

describe('Ownership checks', () => {
  it('another trainer cannot add, edit or delete sessions on my course', async () => {
    const owner = await createRecruiter({ role: 'TRAINING_AGENT' }, 'trainer');
    const other = await createRecruiter({ role: 'TRAINING_AGENT' }, 'rival');
    const course = await prisma.course.create({
      data: {
        title: 'STCW Basic',
        category: 'Safety',
        description: 'Course',
        price: 100,
        recruiterId: owner.id,
      },
    });
    const ownerToken = sign({ id: owner.id, role: owner.role });
    const otherToken = sign({ id: other.id, role: other.role });
    const body = {
      startDate: new Date(Date.now() + 86400000 * 10).toISOString(),
      endDate: new Date(Date.now() + 86400000 * 12).toISOString(),
      location: 'Southampton',
      totalSeats: 10,
    };

    const denied = await request(app)
      .post(`/api/courses/${course.id}/sessions`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send(body);
    expect(denied.status).toBe(403);

    const created = await request(app)
      .post(`/api/courses/${course.id}/sessions`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(body);
    expect(created.status).toBe(201);
    const sessionId = created.body.data.session.id;

    const edit = await request(app)
      .patch(`/api/courses/sessions/${sessionId}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ location: 'Nowhere' });
    expect(edit.status).toBe(403);

    const del = await request(app)
      .delete(`/api/courses/sessions/${sessionId}`)
      .set('Authorization', `Bearer ${otherToken}`);
    expect(del.status).toBe(403);

    const ownerEdit = await request(app)
      .patch(`/api/courses/sessions/${sessionId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ location: 'Liverpool' });
    expect(ownerEdit.status).toBe(200);
  });

  it('a course owner cannot clear the moderation flag on their course', async () => {
    const owner = await createRecruiter({ role: 'TRAINING_AGENT' }, 'flagged');
    const course = await prisma.course.create({
      data: {
        title: 'Flagged course',
        category: 'Safety',
        description: 'Course',
        price: 100,
        recruiterId: owner.id,
        isFlagged: true,
        flagReason: 'Under review',
      },
    });
    const res = await request(app)
      .patch(`/api/courses/${course.id}`)
      .set(
        'Authorization',
        `Bearer ${sign({ id: owner.id, role: owner.role })}`,
      )
      .send({ isFlagged: false, flagReason: '', title: 'Renamed course' });
    expect(res.status).toBe(200);
    const after = await prisma.course.findUnique({ where: { id: course.id } });
    expect(after?.isFlagged).toBe(true);
    expect(after?.title).toBe('Renamed course');
  });

  it('booking a course never attaches documents of another professional', async () => {
    const trainer = await createRecruiter({ role: 'TRAINING_AGENT' }, 'booktr');
    const course = await prisma.course.create({
      data: {
        title: 'Booking course',
        category: 'Safety',
        description: 'Course',
        price: 50,
        status: 'ACTIVE',
        recruiterId: trainer.id,
        sessions: {
          create: {
            startDate: new Date(Date.now() + 86400000 * 20),
            endDate: new Date(Date.now() + 86400000 * 21),
            location: 'Hull',
            totalSeats: 5,
            availableSeats: 5,
          },
        },
      },
      include: { sessions: true },
    });
    const booker = await createProfessional({}, 'booker');
    const victim = await createProfessional({}, 'docvictim');
    const ownDoc = await prisma.professionalDocument.create({
      data: {
        professionalId: booker.id,
        category: 'TRAVEL_DOCUMENTS',
        name: 'My passport',
        fileUrl: 'https://example.com/mine.pdf',
      },
    });
    const victimDoc = await prisma.professionalDocument.create({
      data: {
        professionalId: victim.id,
        category: 'TRAVEL_DOCUMENTS',
        name: 'Victim passport',
        fileUrl: 'https://example.com/theirs.pdf',
      },
    });

    let bookingId: string | undefined;
    const spy = jest
      .spyOn(stripeService, 'createPaymentIntent')
      .mockImplementation((async () => ({
        id: `pi_test_${suffix}`,
        client_secret: 'secret_test',
      })) as never);
    try {
      const res = await request(app)
        .post('/api/professional/course-bookings/checkout')
        .set('Authorization', `Bearer ${sign({ id: booker.id })}`)
        .send({
          courseId: course.id,
          sessionIds: [course.sessions[0].id],
          documentIds: [ownDoc.id, victimDoc.id],
        });
      expect(res.status).toBe(200);
      bookingId = res.body.data.bookingId ?? res.body.data.booking?.id;
    } finally {
      spy.mockRestore();
    }

    const booking = await prisma.courseBooking.findFirst({
      where: bookingId ? { id: bookingId } : { professionalId: booker.id },
      include: { attachedDocuments: { select: { id: true } } },
    });
    const attached = booking?.attachedDocuments.map((d) => d.id) ?? [];
    expect(attached).toContain(ownDoc.id);
    expect(attached).not.toContain(victimDoc.id);
  });

  it('submitting KYC with another id only ever writes your own record', async () => {
    const me = await createProfessional({}, 'kycme');
    const victim = await createProfessional({}, 'kycvictim');
    const res = await request(app)
      .post('/api/professional/kyc/submit')
      .set('Authorization', `Bearer ${sign({ id: me.id })}`)
      .send({
        professionalId: victim.id,
        firstName: 'Me',
        lastName: 'Myself',
        dateOfBirth: '1990-01-01',
        documentType: 'PASSPORT',
        documentNumber: 'X123',
        expiryDate: '2035-01-01',
        issueCountry: 'GB',
        documentFrontUrl: 'https://example.com/front.png',
      });
    expect(res.status).toBe(200);
    expect(
      await prisma.professionalKyc.findUnique({
        where: { professionalId: victim.id },
      }),
    ).toBeNull();
    expect(
      await prisma.professionalKyc.findUnique({
        where: { professionalId: me.id },
      }),
    ).not.toBeNull();
  });

  it('recruitment agents cannot use training-provider dashboard data', async () => {
    const recruiter = await createRecruiter({}, 'notrainer');
    const trainer = await createRecruiter(
      { role: 'TRAINING_AGENT' },
      'istrainer',
    );
    const denied = await request(app)
      .get('/api/trainer/dashboard/demand/expiries')
      .set(
        'Authorization',
        `Bearer ${sign({ id: recruiter.id, role: recruiter.role })}`,
      );
    expect(denied.status).toBe(403);
    const allowed = await request(app)
      .get('/api/trainer/dashboard/stats')
      .set(
        'Authorization',
        `Bearer ${sign({ id: trainer.id, role: trainer.role })}`,
      );
    expect(allowed.status).toBe(200);
  });
});

describe('Uploads', () => {
  it('rejects web-page and script files', async () => {
    const pro = await createProfessional({}, 'uploader');
    for (const [name, type] of [
      ['evil.html', 'text/html'],
      ['evil.svg', 'image/svg+xml'],
    ]) {
      const res = await request(app)
        .post('/api/professional/documents/upload')
        .set('Authorization', `Bearer ${sign({ id: pro.id })}`)
        .field('category', 'TRAVEL_DOCUMENTS')
        .field('name', 'Evil')
        .attach('document', Buffer.from('<script>alert(1)</script>'), {
          filename: name,
          contentType: type,
        });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/not allowed/i);
    }
  });

  it('rejects files over the size limit with a clear message', async () => {
    const pro = await createProfessional({}, 'bigfile');
    const res = await request(app)
      .post('/api/professional/documents/upload')
      .set('Authorization', `Bearer ${sign({ id: pro.id })}`)
      .field('category', 'TRAVEL_DOCUMENTS')
      .attach('document', Buffer.alloc(26 * 1024 * 1024, 1), {
        filename: 'big.pdf',
        contentType: 'application/pdf',
      });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/too large/i);
  });
});

describe('Public job feed', () => {
  it('does not include the poster email for anonymous visitors', async () => {
    const recruiter = await createRecruiter({}, 'poster');
    const job = await prisma.job.create({
      data: {
        title: `Public job ${suffix}`,
        location: 'Remote',
        category: 'OFFICER',
        contractType: 'PERMANENT',
        salary: '1000',
        description: 'Job',
        status: 'ACTIVE',
        recruiterId: recruiter.id,
      },
    });
    try {
      const detail = await request(app).get(`/api/jobs/${job.id}`);
      expect(detail.status).toBe(200);
      expect(detail.body.data.job.recruiter.organizationName).toBeDefined();
      expect(detail.body.data.job.recruiter.email).toBeUndefined();

      const list = await request(app).get('/api/jobs?limit=100');
      expect(list.status).toBe(200);
      expect(JSON.stringify(list.body)).not.toContain(recruiter.email);
    } finally {
      await prisma.job.delete({ where: { id: job.id } });
    }
  });
});

describe('Stored-file fetching (share links)', () => {
  it('treats internal addresses as private', () => {
    for (const ip of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '192.168.1.1',
      '169.254.169.254',
      '::1',
      '::ffff:127.0.0.1',
      'fd00::1',
    ]) {
      expect(isPrivateAddress(ip)).toBe(true);
    }
    expect(isPrivateAddress('8.8.8.8')).toBe(false);
  });

  it('refuses to fetch internal or non-http links', async () => {
    expect(await isPublicHttpUrl('http://127.0.0.1:3000/x')).toBe(false);
    expect(await isPublicHttpUrl('http://localhost/x')).toBe(false);
    expect(await isPublicHttpUrl('http://169.254.169.254/latest')).toBe(false);
    expect(await isPublicHttpUrl('file:///etc/passwd')).toBe(false);
    expect(await isPublicHttpUrl('javascript:alert(1)')).toBe(false);
    expect(await fetchStoredFile('http://127.0.0.1:1/secret')).toBeNull();
  });

  it('recognises our own storage links in public and signed form', () => {
    const base = `${env.SUPABASE_URL}/storage/v1/object`;
    const bucket = env.SUPABASE_DOCUMENT_WALLET_BUCKET;
    expect(parseStorageUrl(`${base}/public/${bucket}/a/b.pdf`)).toEqual({
      bucket,
      path: 'a/b.pdf',
    });
    expect(parseStorageUrl(`${base}/sign/${bucket}/a/b.pdf?token=abc`)).toEqual(
      { bucket, path: 'a/b.pdf' },
    );
    expect(parseStorageUrl(`${base}/public/unknown-bucket/a.pdf`)).toBeNull();
    expect(parseStorageUrl('https://example.com/a.pdf')).toBeNull();
  });
});

describe('Live chat rooms', () => {
  let server: Server;
  let port: number;
  const sockets: Socket[] = [];

  beforeAll(async () => {
    server = createServer(app);
    const io = setupSocket(server);
    app.set('io', io);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    sockets.forEach((s) => s.close());
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const connect = (token: string) =>
    new Promise<Socket>((resolve, reject) => {
      const socket = ioClient(`http://localhost:${port}`, {
        auth: { token },
        transports: ['websocket'],
        forceNew: true,
      });
      sockets.push(socket);
      socket.on('connect', () => resolve(socket));
      socket.on('connect_error', reject);
    });

  it('an outsider cannot listen to a conversation or private room of others', async () => {
    const recruiter = await createRecruiter({}, 'chatrec');
    const pro = await createProfessional({}, 'chatpro');
    const outsider = await createProfessional({}, 'outsider');
    const conversation = await prisma.conversation.create({
      data: { professionalId: pro.id, recruiterId: recruiter.id },
    });

    const participant = await connect(sign({ id: pro.id }));
    const spy = await connect(sign({ id: outsider.id }));

    const participantGot: unknown[] = [];
    const spyGot: unknown[] = [];
    participant.on('new_message', (m) => participantGot.push(m));
    spy.on('new_message', (m) => spyGot.push(m));
    spy.on('update_conversation', (m) => spyGot.push(m));

    participant.emit('join_conversation', conversation.id);
    spy.emit('join_conversation', conversation.id);
    // Trying to join the recruiter's private notification room.
    spy.emit('join_conversation', recruiter.id);
    await new Promise((r) => setTimeout(r, 400));

    const send = await request(app)
      .post(`/api/conversations/${conversation.id}/messages`)
      .set(
        'Authorization',
        `Bearer ${sign({ id: recruiter.id, role: recruiter.role })}`,
      )
      .send({ content: 'Private hello' });
    expect([200, 201]).toContain(send.status);
    await new Promise((r) => setTimeout(r, 600));

    expect(participantGot.length).toBeGreaterThan(0);
    expect(spyGot).toHaveLength(0);
  });
});

describe('Second-round fixes', () => {
  it('code guessing cannot dodge the limit by adding a random email', async () => {
    const pro = await createProfessional(
      {
        status: 'PENDING',
        registrationStep: 1,
        isVerified: false,
        otpCode: '777777',
        otpExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
      'otp-email-trick',
    );
    const statuses: number[] = [];
    for (let i = 0; i < 11; i += 1) {
      const res = await request(app)
        .post('/api/professional/verify-otp')
        .send({
          professionalId: pro.id,
          code: String(300000 + i),
          email: `random-${i}@example.com`,
        });
      statuses.push(res.status);
    }
    expect(statuses[10]).toBe(429);
  });

  it('logins refused for an unfinished signup do not count towards the lockout', async () => {
    const pro = await createProfessional(
      { status: 'PENDING', registrationStep: 3 },
      'stuck-signup',
    );
    for (let i = 0; i < 12; i += 1) {
      const res = await request(app)
        .post('/api/professional/login')
        .send({ email: pro.email, password });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('SIGNUP_INCOMPLETE');
    }
  });

  it('suspended professionals are refused by the unified login and live chat', async () => {
    const pro = await createProfessional(
      { status: 'SUSPENDED', suspensionReason: 'Test' },
      'suspended',
    );
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: pro.email, password });
    expect(login.status).toBe(403);
    expect(login.body.token).toBeUndefined();
  });

  it('file links in requests must belong to the sender', () => {
    const me = '11111111-2222-3333-4444-555555555555';
    const other = '99999999-8888-7777-6666-555555555555';
    const mine = new Set([me]);
    expect(storagePathBelongsTo(`${me}/resumes/1-cv.pdf`, mine)).toBe(true);
    expect(storagePathBelongsTo(`profile-photos/${me}-1-a.png`, mine)).toBe(
      true,
    );
    expect(storagePathBelongsTo('kyc-docs/123-front.png', mine)).toBe(true);
    expect(storagePathBelongsTo(`${other}/1-passport.pdf`, mine)).toBe(false);
    expect(
      storagePathBelongsTo(`professional-kyc-docs/${other}/1-front.png`, mine),
    ).toBe(false);
  });

  it('refuses a request that tries to save a file link of another user', async () => {
    const me = await createProfessional({}, 'linkthief');
    const victim = await createProfessional({}, 'linkvictim');
    const victimUrl = `${env.SUPABASE_URL}/storage/v1/object/public/${env.SUPABASE_PROFESSIONAL_KYC_DOCS_BUCKET}/professional-kyc-docs/${victim.id}/1-front.png`;
    const res = await request(app)
      .post('/api/professional/kyc/submit')
      .set('Authorization', `Bearer ${sign({ id: me.id })}`)
      .send({
        firstName: 'Me',
        lastName: 'Thief',
        dateOfBirth: '1990-01-01',
        documentType: 'PASSPORT',
        documentNumber: 'X1',
        expiryDate: '2035-01-01',
        issueCountry: 'GB',
        documentFrontUrl: victimUrl,
      });
    expect(res.status).toBe(400);
    expect(
      await prisma.professionalKyc.findUnique({
        where: { professionalId: me.id },
      }),
    ).toBeNull();

    // Own file link is fine.
    const ownUrl = `${env.SUPABASE_URL}/storage/v1/object/public/${env.SUPABASE_PROFESSIONAL_KYC_DOCS_BUCKET}/professional-kyc-docs/${me.id}/1-front.png`;
    const ok = await request(app)
      .post('/api/professional/kyc/submit')
      .set('Authorization', `Bearer ${sign({ id: me.id })}`)
      .send({
        firstName: 'Me',
        lastName: 'Honest',
        dateOfBirth: '1990-01-01',
        documentType: 'PASSPORT',
        documentNumber: 'X1',
        expiryDate: '2035-01-01',
        issueCountry: 'GB',
        documentFrontUrl: ownUrl,
      });
    expect(ok.status).toBe(200);
  });

  it('blocks internal addresses in every IPv4/IPv6 spelling', async () => {
    for (const ip of [
      '::ffff:a9fe:a9fe', // 169.254.169.254, hex-mapped
      '::ffff:7f00:1', // 127.0.0.1, hex-mapped
      '::7f00:1', // IPv4-compatible
      '64:ff9b::a9fe:a9fe', // NAT64
      '0:0:0:0:0:ffff:a00:1', // 10.0.0.1 expanded
    ]) {
      expect(isPrivateAddress(ip)).toBe(true);
    }
    expect(isPrivateAddress('2606:4700:4700::1111')).toBe(false);
    expect(await isPublicHttpUrl('http://[::ffff:a9fe:a9fe]/latest')).toBe(
      false,
    );
    expect(await isPublicHttpUrl('http://2130706433/')).toBe(false); // 127.0.0.1
    expect(await fetchStoredFile('http://[::ffff:7f00:1]:1/x')).toBeNull();
  });

  it('a hostname that resolves to an internal address is refused at connect time', async () => {
    const server = createServer((_req, res) => res.end('internal secret'));
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as AddressInfo).port;
    try {
      // localtest.me publicly resolves to 127.0.0.1.
      const res = await fetchStoredFile(`http://localtest.me:${port}/`);
      expect(res).toBeNull();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('a trainer payout is released only once, and a paid-out booking cannot be reopened', async () => {
    const trainer = await createRecruiter(
      {
        role: 'TRAINING_AGENT',
        stripeAccountId: 'acct_test_trainer',
        stripeOnboardingComplete: true,
      },
      'payout',
    );
    const pro = await createProfessional({}, 'payoutpro');
    const course = await prisma.course.create({
      data: {
        title: 'Payout course',
        category: 'Safety',
        description: 'Course',
        price: 100,
        status: 'ACTIVE',
        recruiterId: trainer.id,
        sessions: {
          create: {
            startDate: new Date(Date.now() + 86400000 * 5),
            endDate: new Date(Date.now() + 86400000 * 6),
            location: 'Hull',
            totalSeats: 5,
            availableSeats: 4,
          },
        },
      },
      include: { sessions: true },
    });
    const booking = await prisma.courseBooking.create({
      data: {
        professionalId: pro.id,
        courseId: course.id,
        amountPaid: 100,
        currency: 'GBP',
        bookingStatus: 'CONFIRMED',
        paymentStatus: 'SUCCEEDED',
        sessions: { connect: [{ id: course.sessions[0].id }] },
      },
    });
    const token = `Bearer ${sign({ id: trainer.id, role: trainer.role })}`;
    const transfer = jest
      .spyOn(stripeService, 'createTransfer')
      .mockImplementation((async () => ({ id: 'tr_test' })) as never);
    try {
      const approvePath = `/api/trainer/sessions/${course.sessions[0].id}/attendees/${booking.id}/approve`;
      const [a, b] = await Promise.all([
        request(app).post(approvePath).set('Authorization', token),
        request(app).post(approvePath).set('Authorization', token),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 400]);
      expect(transfer).toHaveBeenCalledTimes(1);

      const reopen = await request(app)
        .patch(`/api/courses/trainer/bookings/${booking.id}/status`)
        .set('Authorization', token)
        .send({ status: 'PENDING' });
      expect(reopen.status).toBe(400);

      const again = await request(app)
        .post(approvePath)
        .set('Authorization', token);
      expect(again.status).toBe(400);
      expect(transfer).toHaveBeenCalledTimes(1);
    } finally {
      transfer.mockRestore();
    }
  });

  it('confirming payment never turns a refunded booking back into paid', async () => {
    const trainer = await createRecruiter(
      { role: 'TRAINING_AGENT' },
      'refundtr',
    );
    const pro = await createProfessional({}, 'refundpro');
    const course = await prisma.course.create({
      data: {
        title: 'Refund course',
        category: 'Safety',
        description: 'Course',
        price: 100,
        recruiterId: trainer.id,
      },
    });
    const booking = await prisma.courseBooking.create({
      data: {
        professionalId: pro.id,
        courseId: course.id,
        amountPaid: 100,
        currency: 'GBP',
        bookingStatus: 'CANCELLED',
        paymentStatus: 'REFUNDED',
        stripePaymentIntentId: 'pi_refunded_test',
      },
    });
    const retrieve = jest
      .spyOn(stripeService, 'retrievePaymentIntent')
      .mockImplementation((async () => ({ status: 'succeeded' })) as never);
    try {
      const res = await request(app)
        .post(`/api/professional/course-bookings/${booking.id}/confirm`)
        .set('Authorization', `Bearer ${sign({ id: pro.id })}`);
      expect(res.status).toBe(200);
      const after = await prisma.courseBooking.findUnique({
        where: { id: booking.id },
      });
      expect(after?.paymentStatus).toBe('REFUNDED');
      expect(after?.bookingStatus).toBe('CANCELLED');
    } finally {
      retrieve.mockRestore();
    }
  });
});
