import { jest } from '@jest/globals';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import app from '../app.js';
import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import { COURSE_COMMISSION_RATE } from '../config/commission.js';
import { stripeService } from '../services/stripeService.js';

/**
 * Every number on the admin dashboard follows the product's rules:
 *   - unfinished sign-ups (email never confirmed, never approved) are not users
 *     and are not waiting for review;
 *   - Pending Approvals = account reviews + ID checks (both admin reviews);
 *   - Flagged Issues includes open user reports;
 *   - jobs/courses still in draft were never posted;
 *   - a booking counts once it is paid (unpaid checkouts don't);
 *   - MaritimeLink's own courses earn the whole sale and owe no payout;
 *   - system alerts only look at the last 7 days.
 *
 * Other test files share the database and run alongside this one, so each
 * figure is compared with an independent SQL count of the rule (taken right
 * after the API call) rather than a fixed number. The fixtures below include
 * one record for every edge case, so a wrong rule shows up as a mismatch.
 */

const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const sign = (payload: object) =>
  jwt.sign(payload, env.JWT_SECRET, { expiresIn: '1h' });
const email = (label: string) => `dash-${label}-${suffix}@example.com`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const money = (n: unknown) => Math.round(Number(n) * 100) / 100;
const PAYOUT_RATE = 1 - COURSE_COMMISSION_RATE;

const ids = {
  admin: '',
  professionals: [] as string[],
  recruiters: [] as string[],
  courses: [] as string[],
  jobs: [] as string[],
  bookings: [] as string[],
  reports: [] as string[],
  logs: [] as string[],
};
let auth = '';
let provider = '';
let unfinishedPro = '';
let unfinishedRecruiter = '';
let awaitingPro = '';

/** Re-read until the API and the SQL agree, to ride out writes from other test files. */
const settle = async (
  read: () => Promise<[unknown, unknown]>,
): Promise<[unknown, unknown]> => {
  let last: [unknown, unknown] = [null, null];
  for (let i = 0; i < 6; i += 1) {
    last = await read();
    if (JSON.stringify(last[0]) === JSON.stringify(last[1])) return last;
    await sleep(250);
  }
  return last;
};

const count = async (sql: string, ...params: unknown[]) => {
  const rows = await prisma.$queryRawUnsafe<{ n: bigint | number }[]>(
    sql,
    ...params,
  );
  return Number(rows[0]?.n ?? 0);
};

const makePro = async (
  label: string,
  data: { isVerified: boolean; status: 'PENDING' | 'VERIFIED' | 'FLAGGED' },
) => {
  const p = await prisma.professional.create({
    data: { email: email(label), password: 'x', fullname: label, ...data },
  });
  ids.professionals.push(p.id);
  return p.id;
};

const makeRecruiter = async (
  label: string,
  data: {
    role: 'RECRUITMENT_AGENT' | 'TRAINING_AGENT';
    isVerified: boolean;
    status: 'PENDING' | 'APPROVED' | 'REJECTED';
  },
) => {
  const r = await prisma.recruiter.create({
    data: {
      email: email(label),
      password: 'x',
      organizationName: label,
      ...data,
    },
  });
  ids.recruiters.push(r.id);
  return r.id;
};

const kycFields = {
  firstName: 'Test',
  lastName: 'Person',
  dateOfBirth: new Date('1990-01-01'),
  documentType: 'PASSPORT' as const,
  documentNumber: 'X123',
  expiryDate: new Date('2035-01-01'),
  issueCountry: 'GB',
};

beforeAll(async () => {
  jest.spyOn(stripeService, 'summarizeMembershipRevenue').mockResolvedValue({
    professionals: { subscribers: 0, revenue: 0 },
    recruiters: { subscribers: 0, revenue: 0 },
    currency: 'GBP',
  });

  const admin = await prisma.admin.create({
    data: {
      email: email('admin'),
      password: await bcrypt.hash('Password123!', 4),
      role: 'SUPER_ADMIN',
    },
  });
  ids.admin = admin.id;
  auth = `Bearer ${sign({ id: admin.id, role: 'SUPER_ADMIN' })}`;

  // Accounts: one of every state that matters.
  unfinishedPro = await makePro('unfinished-pro', {
    isVerified: false,
    status: 'PENDING',
  });
  awaitingPro = await makePro('awaiting-pro', {
    isVerified: true,
    status: 'PENDING',
  });
  const kycPro = await makePro('kyc-pro', {
    isVerified: true,
    status: 'VERIFIED',
  });
  await makePro('flagged-pro', { isVerified: true, status: 'FLAGGED' });
  const rejectedPro = await makePro('rejected-pro', {
    isVerified: true,
    status: 'VERIFIED',
  });
  await prisma.professionalKyc.create({
    data: { professionalId: kycPro, status: 'PENDING', ...kycFields },
  });
  await prisma.professionalKyc.create({
    data: { professionalId: rejectedPro, status: 'REJECTED', ...kycFields },
  });

  unfinishedRecruiter = await makeRecruiter('unfinished-rec', {
    role: 'RECRUITMENT_AGENT',
    isVerified: false,
    status: 'PENDING',
  });
  const awaitingRecruiter = await makeRecruiter('awaiting-rec', {
    role: 'RECRUITMENT_AGENT',
    isVerified: true,
    status: 'PENDING',
  });
  await prisma.recruiterKyc.create({
    data: { recruiterId: awaitingRecruiter, status: 'PENDING', ...kycFields },
  });
  await makeRecruiter('rejected-rec', {
    role: 'RECRUITMENT_AGENT',
    isVerified: true,
    status: 'REJECTED',
  });
  provider = await makeRecruiter('provider', {
    role: 'TRAINING_AGENT',
    isVerified: true,
    status: 'APPROVED',
  });

  // Jobs: a draft (never posted) and a flagged live one.
  for (const [label, status, isFlagged] of [
    ['draft', 'DRAFT', false],
    ['flagged', 'ACTIVE', true],
  ] as const) {
    const job = await prisma.job.create({
      data: {
        title: `Dash ${label} ${suffix}`,
        location: 'Remote',
        category: 'OFFICER',
        contractType: 'CONTRACT',
        salary: '1',
        description: 'x',
        recruiterId: awaitingRecruiter,
        status,
        isFlagged,
      },
    });
    ids.jobs.push(job.id);
  }

  // Courses: a provider course, MaritimeLink's own course, and a draft.
  const course = async (
    label: string,
    owner: { recruiterId?: string; adminId?: string },
    status: 'ACTIVE' | 'DRAFT',
    price: number,
  ) => {
    const c = await prisma.course.create({
      data: {
        title: `Dash ${label} ${suffix}`,
        category: 'Safety',
        description: 'x',
        price,
        status,
        ...owner,
      },
    });
    ids.courses.push(c.id);
    return c.id;
  };
  const providerCourse = await course(
    'provider',
    { recruiterId: provider },
    'ACTIVE',
    100,
  );
  const ownCourse = await course(
    'maritimelink',
    { adminId: admin.id },
    'ACTIVE',
    50,
  );
  await course('draft', { recruiterId: provider }, 'DRAFT', 10);

  // Bookings: paid (payout still owed), paid on our own course, an unpaid
  // checkout that was abandoned, and a refunded one.
  const booking = async (
    courseId: string,
    amountPaid: number,
    paymentStatus: 'SUCCEEDED' | 'PENDING' | 'REFUNDED',
  ) => {
    const b = await prisma.courseBooking.create({
      data: {
        professionalId: kycPro,
        courseId,
        amountPaid,
        paymentStatus,
        bookingStatus: paymentStatus === 'SUCCEEDED' ? 'CONFIRMED' : 'PENDING',
        paidAt: paymentStatus === 'PENDING' ? null : new Date(),
      },
    });
    ids.bookings.push(b.id);
  };
  await booking(providerCourse, 100, 'SUCCEEDED');
  await booking(ownCourse, 50, 'SUCCEEDED');
  await booking(providerCourse, 100, 'PENDING');
  await booking(providerCourse, 100, 'REFUNDED');

  // An open user report.
  const report = await prisma.userReport.create({
    data: {
      reference: `DASH-${suffix}`,
      reporterId: kycPro,
      reporterType: 'PROFESSIONAL',
      reportedId: awaitingRecruiter,
      reportedType: 'RECRUITER',
      reason: 'SPAM',
      details: 'x',
    },
  });
  ids.reports.push(report.id);

  // Failed actions: one today, one long ago (outside the alert window).
  for (const daysAgo of [0, 10]) {
    const log = await prisma.activityLog.create({
      data: {
        action: `DASH_TEST_FAILURE_${suffix}`,
        actorId: kycPro,
        actorType: 'PROFESSIONAL',
        status: 'FAILED',
        createdAt: new Date(Date.now() - daysAgo * 24 * 3600 * 1000),
      },
    });
    ids.logs.push(log.id);
  }
});

afterAll(async () => {
  await prisma.activityLog.deleteMany({ where: { id: { in: ids.logs } } });
  await prisma.userReport.deleteMany({ where: { id: { in: ids.reports } } });
  await prisma.courseBooking.deleteMany({
    where: { id: { in: ids.bookings } },
  });
  await prisma.course.deleteMany({ where: { id: { in: ids.courses } } });
  await prisma.job.deleteMany({ where: { id: { in: ids.jobs } } });
  await prisma.professionalKyc.deleteMany({
    where: { professionalId: { in: ids.professionals } },
  });
  await prisma.recruiterKyc.deleteMany({
    where: { recruiterId: { in: ids.recruiters } },
  });
  await prisma.professional.deleteMany({
    where: { id: { in: ids.professionals } },
  });
  await prisma.recruiter.deleteMany({ where: { id: { in: ids.recruiters } } });
  await prisma.admin.deleteMany({ where: { id: ids.admin } });
});

const get = (path: string) => request(app).get(path).set('Authorization', auth);

const sql = {
  accountReviews: () =>
    count(`select (select count(*) from "Professional" where status = 'PENDING' and "isVerified")
                + (select count(*) from "Recruiter" where status = 'PENDING' and "isVerified") as n`),
  idChecks: () =>
    count(`select (select count(*) from professional_kyc where status = 'PENDING')
                + (select count(*) from recruiter_kyc where status = 'PENDING') as n`),
  flagged: () =>
    count(`select (select count(*) from user_reports where status in ('PENDING','UNDER_REVIEW'))
                + (select count(*) from jobs where "isFlagged")
                + (select count(*) from courses where "isFlagged")
                + (select count(*) from "Recruiter" where status = 'FLAGGED')
                + (select count(*) from "Professional" where status = 'FLAGGED') as n`),
  rejected: () =>
    count(`select (select count(*) from "Recruiter" where status = 'REJECTED')
                + (select count(*) from professional_kyc where status = 'REJECTED') as n`),
  jobsPosted: () =>
    count('select count(*) as n from jobs where status::text <> $1', 'DRAFT'),
  coursesPosted: () =>
    count(
      'select count(*) as n from courses where status::text <> $1',
      'DRAFT',
    ),
  paidBookings: () =>
    count(
      'select count(*) as n from course_bookings where "paymentStatus"::text = $1',
      'SUCCEEDED',
    ),
  accounts: (table: string, role?: string) =>
    count(
      `select count(*) as n from "${table}" where not ("isVerified" = false and status = 'PENDING')${role ? ` and role = '${role}'` : ''}`,
    ),
  unfinished: () =>
    count(`select (select count(*) from "Professional" where "isVerified" = false and status = 'PENDING')
                + (select count(*) from "Recruiter" where "isVerified" = false and status = 'PENDING') as n`),
};

describe('admin dashboard numbers follow the product rules', () => {
  it('Pending Approvals = account reviews (finished sign-ups) + ID checks', async () => {
    const [api, expected] = await settle(async () => {
      const res = await get('/api/admin/dashboard/stats');
      const p = res.body.data.stats.pendingApprovals;
      const accountReviews = await sql.accountReviews();
      const idChecks = await sql.idChecks();
      return [
        [p.total, p.accountReviews, p.idChecks],
        [accountReviews + idChecks, accountReviews, idChecks],
      ];
    });
    expect(api).toEqual(expected);
  });

  it('Flagged Issues includes open user reports; rejected accounts are counted for their own page', async () => {
    const [api, expected] = await settle(async () => {
      const res = await get('/api/admin/dashboard/stats');
      const s = res.body.data.stats;
      return [
        [s.flaggedIssues, s.rejectedAccounts],
        [await sql.flagged(), await sql.rejected()],
      ];
    });
    expect(api).toEqual(expected);
    const res = await get('/api/admin/dashboard/stats');
    expect(res.body.data.stats.flaggedBreakdown.reports).toBeGreaterThanOrEqual(
      1,
    );
  });

  it('Platform Activity: drafts are not posted, unpaid checkouts are not bookings, unfinished sign-ups are not users', async () => {
    const [api, expected] = await settle(async () => {
      const res = await get('/api/admin/dashboard/activity');
      const { activity: a, userBreakdown: u } = res.body.data;
      return [
        [
          a.jobsPosted,
          a.coursesPosted,
          a.bookingsMade,
          u.providers,
          u.recruiters,
          u.professionals,
          u.unfinishedSignups,
        ],
        [
          await sql.jobsPosted(),
          await sql.coursesPosted(),
          await sql.paidBookings(),
          await sql.accounts('Recruiter', 'TRAINING_AGENT'),
          await sql.accounts('Recruiter', 'RECRUITMENT_AGENT'),
          await sql.accounts('Professional'),
          await sql.unfinished(),
        ],
      ];
    });
    expect(api).toEqual(expected);
  });

  it('Review Queue shows the real total and never lists unfinished sign-ups', async () => {
    const [api, expected] = await settle(async () => {
      const res = await get('/api/admin/dashboard/queues');
      return [
        res.body.data.reviewQueueTotal,
        (await sql.accountReviews()) + (await sql.idChecks()),
      ];
    });
    expect(api).toEqual(expected);

    const res = await get('/api/admin/dashboard/queues');
    const listed = res.body.data.reviewQueue.map((i: { id: string }) => i.id);
    expect(listed).not.toContain(unfinishedPro);
    expect(listed).not.toContain(unfinishedRecruiter);
    expect(listed).toContain(awaitingPro);
  });

  it('System alerts only count failures from the last 7 days', async () => {
    const [api, expected] = await settle(async () => {
      const res = await get('/api/admin/dashboard/queues');
      const alert = res.body.data.systemAlerts.find(
        (a: { id: string }) => a.id === 'failed-activity-logs',
      );
      const n = await count(
        'select count(*) as n from activity_logs where status::text = $1 and "createdAt" >= now() - $2::interval',
        'FAILED',
        '7 days',
      );
      return [
        alert?.message ?? null,
        `${n} failed platform action${n === 1 ? '' : 's'} in the last 7 days.`,
      ];
    });
    expect(api).toEqual(expected);
  });

  it('Training revenue: our own courses earn the whole sale and owe no payout', async () => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const [api, expected] = await settle(async () => {
      const res = await get('/api/admin/dashboard/revenue');
      const t = res.body.data.training;
      const rows = await prisma.$queryRawUnsafe<
        { commission: unknown; cost: unknown; gross: unknown }[]
      >(
        `select
           coalesce(sum(case when c."recruiterId" is null then b."amountPaid"
                             else coalesce(b."platformFee", b."amountPaid" * $2) end), 0) as commission,
           coalesce(sum(case when c."recruiterId" is null then 0
                             else coalesce(b."trainerPayout", b."amountPaid" * $3) end), 0) as cost,
           coalesce(sum(b."amountPaid"), 0) as gross
         from course_bookings b join courses c on c.id = b."courseId"
         where b."paymentStatus" = 'SUCCEEDED' and b."paidAt" >= $1`,
        monthStart,
        COURSE_COMMISSION_RATE,
        PAYOUT_RATE,
      );
      const pending = await prisma.$queryRawUnsafe<{ owed: unknown }[]>(
        `select coalesce(sum(b."amountPaid" * $1), 0) as owed
         from course_bookings b join courses c on c.id = b."courseId"
         where b."paymentStatus" = 'SUCCEEDED' and c."recruiterId" is not null
           and (b."trainerPayout" is null or b."trainerPayout" = 0)`,
        PAYOUT_RATE,
      );
      return [
        [
          money(t.commissionRevenue),
          money(t.costOfSales),
          money(t.grossSales),
          money(t.pendingPayouts),
        ],
        [
          money(rows[0].commission),
          money(rows[0].cost),
          money(rows[0].gross),
          money(pending[0].owed),
        ],
      ];
    });
    expect(api).toEqual(expected);
  });

  it('per-provider list counts only paid bookings on that provider’s courses', async () => {
    const res = await get('/api/admin/revenue');
    expect(res.status).toBe(200);
    const row = res.body.data.byTrainer.find(
      (t: { recruiterId: string }) => t.recruiterId === provider,
    );
    expect(row).toMatchObject({ bookings: 1, revenue: 100 });
    expect(money(row.payout)).toBe(money(100 * PAYOUT_RATE));
  });
});
