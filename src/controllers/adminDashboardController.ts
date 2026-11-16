import { Response } from 'express';
import { prisma } from '../config/prisma.js';
import {
  platformShareOf,
  providerShareOf,
  payoutFor,
  type RevenueBooking,
} from '../config/commission.js';
import { stripeService } from '../services/stripeService.js';
import { PROFESSIONALS_FREE_PRO } from '../config/professionalMembership.js';
import { catchAsync } from '../utils/catchAsync.js';
import { CustomRequest } from '../types/index.js';
import {
  DocumentCategory,
  PaymentStatus,
  Prisma,
  RecruiterStatus,
  VerificationStatus,
} from '../generated/client/index.js';

const round2 = (value: number) =>
  Math.round((value + Number.EPSILON) * 100) / 100;

/**
 * Month-over-month change as a signed percentage string, or `null` when there is
 * no prior figure to compare against (growth from zero is not a percentage).
 */
const percentGrowth = (current: number, previous: number): string | null => {
  if (!previous) return null;
  const change = ((current - previous) / previous) * 100;
  const rounded = Math.round(change * 10) / 10;
  return `${rounded >= 0 ? '+' : ''}${rounded}%`;
};

const statusColor = (status: string) => {
  if (status === 'SUCCESS' || status === 'SUCCEEDED') {
    return 'text-green-600 bg-green-50';
  }
  if (status === 'FAILED') return 'text-red-600 bg-red-50';
  if (status === 'WARNING' || status === 'PENDING') {
    return 'text-orange-600 bg-orange-50';
  }
  return 'text-blue-600 bg-blue-50';
};

const transactionStatusLabel = (status: string) => {
  if (status === 'SUCCEEDED') return 'Completed';
  if (status === 'PENDING') return 'Pending';
  if (status === 'FAILED') return 'Failed';
  if (status === 'REFUNDED') return 'Refunded';
  return status;
};

const getReportStartDate = (range: string) => {
  const now = new Date();
  const startDate = new Date(now);

  if (range === 'today') {
    startDate.setHours(0, 0, 0, 0);
    return startDate;
  }

  if (range === '30d') {
    startDate.setDate(now.getDate() - 30);
    return startDate;
  }

  startDate.setDate(now.getDate() - 7);
  return startDate;
};

/** How far back to count already-expired compliance docs (unique professionals). */
const ADMIN_COMPLIANCE_EXPIRED_LOOKBACK_DAYS = 365;

/**
 * A sign-up that was never finished: the email code was never confirmed and
 * no admin has approved the account. Not a real user, and nothing to review.
 */
const UNFINISHED_SIGNUP = { isVerified: false, status: 'PENDING' } as const;

/** Real accounts: everyone except unfinished sign-ups. */
const REGISTERED_ACCOUNT = { NOT: UNFINISHED_SIGNUP };

/** Finished sign-up, waiting for an admin's account review. */
const AWAITING_ACCOUNT_REVIEW = {
  status: 'PENDING',
  isVerified: true,
} as const;

/** User reports an admin still has to deal with. */
const OPEN_USER_REPORT = {
  status: { in: ['PENDING', 'UNDER_REVIEW'] },
} as Prisma.UserReportWhereInput;

/** System alerts look at this recent window, not all of history. */
const SYSTEM_ALERT_WINDOW_DAYS = 7;

/** Latest items taken from each review source for the dashboard list. */
const REVIEW_QUEUE_PER_SOURCE = 10;

const formatBucketLabel = (date: Date, range: string) => {
  if (range === 'today') {
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  }

  if (range === '30d') {
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  }

  return date.toLocaleDateString('en-US', { weekday: 'short' });
};

const buildReportBuckets = (range: string) => {
  const now = new Date();
  const buckets: { label: string; start: Date; end: Date }[] = [];

  if (range === 'today') {
    const start = getReportStartDate('today');
    for (let i = 0; i < 6; i += 1) {
      const bucketStart = new Date(start);
      bucketStart.setHours(i * 4, 0, 0, 0);
      const bucketEnd = new Date(start);
      bucketEnd.setHours((i + 1) * 4, 0, 0, 0);
      buckets.push({
        label: formatBucketLabel(bucketStart, range),
        start: bucketStart,
        end: i === 5 ? now : bucketEnd,
      });
    }
    return buckets;
  }

  const days = range === '30d' ? 30 : 7;
  for (let i = days - 1; i >= 0; i -= 1) {
    const bucketStart = new Date(now);
    bucketStart.setDate(now.getDate() - i);
    bucketStart.setHours(0, 0, 0, 0);
    const bucketEnd = new Date(bucketStart);
    bucketEnd.setDate(bucketStart.getDate() + 1);
    buckets.push({
      label: formatBucketLabel(bucketStart, range),
      start: bucketStart,
      end: i === 0 ? now : bucketEnd,
    });
  }
  return buckets;
};

/**
 * @desc    Get admin dashboard stats (top cards)
 * @route   GET /api/admin/dashboard/stats
 * @access  Private (Admin)
 */
export const getAdminDashboardStats = catchAsync(
  async (req: CustomRequest, res: Response) => {
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const requestedTimeframe =
      typeof req.query.timeframe === 'string' ? req.query.timeframe : '30d';
    const timeframe = String(requestedTimeframe).toLowerCase();
    const daysByTimeframe: Record<string, number> = {
      today: 1,
      '7d': 7,
      '30d': 30,
      '60d': 60,
      '90d': 90,
    };
    const complianceWindowDays = daysByTimeframe[timeframe] || 30;
    const complianceWindowEnd = new Date(todayStart);
    complianceWindowEnd.setDate(
      complianceWindowEnd.getDate() + complianceWindowDays,
    );
    complianceWindowEnd.setHours(23, 59, 59, 999);

    const complianceExpiredLookbackStart = new Date(todayStart);
    complianceExpiredLookbackStart.setDate(
      complianceExpiredLookbackStart.getDate() -
        ADMIN_COMPLIANCE_EXPIRED_LOOKBACK_DAYS,
    );

    // 1. Pending Approvals — both admin reviews:
    //    account review (Accounts page) for anyone who finished sign-up, and
    //    the ID check (Compliance page) for every KYC submission waiting.
    const [
      pendingProfessionalAccounts,
      pendingRecruiterAccounts,
      pendingProKyc,
      pendingRecruiterKyc,
      pendingAccountsToday,
      pendingKycToday,
    ] = await Promise.all([
      prisma.professional.count({ where: AWAITING_ACCOUNT_REVIEW }),
      prisma.recruiter.count({ where: AWAITING_ACCOUNT_REVIEW }),
      prisma.professionalKyc.count({ where: { status: 'PENDING' } }),
      prisma.recruiterKyc.count({ where: { status: 'PENDING' } }),
      Promise.all([
        prisma.professional.count({
          where: { ...AWAITING_ACCOUNT_REVIEW, createdAt: { gte: todayStart } },
        }),
        prisma.recruiter.count({
          where: { ...AWAITING_ACCOUNT_REVIEW, createdAt: { gte: todayStart } },
        }),
      ]).then(([a, b]) => a + b),
      Promise.all([
        prisma.professionalKyc.count({
          where: { status: 'PENDING', createdAt: { gte: todayStart } },
        }),
        prisma.recruiterKyc.count({
          where: { status: 'PENDING', createdAt: { gte: todayStart } },
        }),
      ]).then(([a, b]) => a + b),
    ]);
    const pendingAccountReviews =
      pendingProfessionalAccounts + pendingRecruiterAccounts;
    const pendingIdChecks = pendingProKyc + pendingRecruiterKyc;

    // 2. Flagged Issues — everything waiting on moderation: open user
    //    reports, jobs/courses an admin flagged, and flagged accounts.
    const [
      flaggedJobs,
      flaggedCourses,
      flaggedRecruiters,
      flaggedProfessionals,
      openReports,
      rejectedRecruiters,
      rejectedProfessionals,
    ] = await Promise.all([
      prisma.job.count({ where: { isFlagged: true } }),
      prisma.course.count({ where: { isFlagged: true } }),
      prisma.recruiter.count({ where: { status: 'FLAGGED' } }),
      prisma.professional.count({ where: { status: 'FLAGGED' } }),
      prisma.userReport.count({ where: OPEN_USER_REPORT }),
      // What the "Flagged Accounts" page lists (accounts rejected in review).
      prisma.recruiter.count({ where: { status: 'REJECTED' } }),
      prisma.professional.count({ where: { kyc: { status: 'REJECTED' } } }),
    ]);

    // 3. Compliance renewal attention: unique professionals with a compliance doc
    //    expired within lookback OR expiring by end of forward window (not only VERIFIED).
    const expiringComplianceGroups = await prisma.professionalDocument.groupBy({
      by: ['professionalId'],
      where: {
        expiryDate: {
          not: null,
          gte: complianceExpiredLookbackStart,
          lte: complianceWindowEnd,
        },
        verificationStatus: { not: VerificationStatus.REJECTED },
        category: {
          notIn: [DocumentCategory.CV_RESUME, DocumentCategory.COVER_LETTER],
        },
      },
    });
    const expiringComplianceCount = expiringComplianceGroups.length;

    // 4. Company stats
    const companyCount = await prisma.company.count();
    const unclaimedCompanyCount = await prisma.company.count({
      where: { isClaimed: false },
    });

    res.status(200).json({
      status: 'success',
      data: {
        stats: {
          pendingApprovals: {
            total: pendingAccountReviews + pendingIdChecks,
            today: pendingAccountsToday + pendingKycToday,
            accountReviews: pendingAccountReviews,
            idChecks: pendingIdChecks,
          },
          flaggedIssues:
            openReports +
            flaggedJobs +
            flaggedCourses +
            flaggedRecruiters +
            flaggedProfessionals,
          flaggedBreakdown: {
            reports: openReports,
            content: flaggedJobs + flaggedCourses,
            accounts: flaggedRecruiters + flaggedProfessionals,
          },
          rejectedAccounts: rejectedRecruiters + rejectedProfessionals,
          expiringCompliance: {
            count: expiringComplianceCount,
            timeframe: `${complianceWindowDays}d`,
            expiredLookbackDays: ADMIN_COMPLIANCE_EXPIRED_LOOKBACK_DAYS,
          },
          companies: {
            total: companyCount,
            unclaimed: unclaimedCompanyCount,
          },
        },
      },
    });
  },
);

/**
 * @desc    Get platform activity overview
 * @route   GET /api/admin/dashboard/activity
 * @access  Private (Admin)
 */
export const getPlatformActivity = catchAsync(
  async (req: CustomRequest, res: Response) => {
    const [
      // Posted = published at some point; unpaid/unfinished drafts never went live.
      jobsCount,
      coursesCount,
      applicationsCount,
      // A booking counts once it is paid. The booking row is created when
      // checkout starts, so unpaid, failed and refunded ones are left out.
      bookingsCount,
      // Real accounts only (see REGISTERED_ACCOUNT).
      providersCount,
      recruitersCount,
      professionalsCount,
      unfinishedRecruiterSignups,
      unfinishedProfessionalSignups,
      acceptedApps,
    ] = await Promise.all([
      prisma.job.count({ where: { status: { not: 'DRAFT' } } }),
      prisma.course.count({ where: { status: { not: 'DRAFT' } } }),
      prisma.jobApplication.count(),
      prisma.courseBooking.count({
        where: { paymentStatus: PaymentStatus.SUCCEEDED },
      }),
      prisma.recruiter.count({
        where: { role: 'TRAINING_AGENT', ...REGISTERED_ACCOUNT },
      }),
      prisma.recruiter.count({
        where: { role: 'RECRUITMENT_AGENT', ...REGISTERED_ACCOUNT },
      }),
      prisma.professional.count({ where: REGISTERED_ACCOUNT }),
      prisma.recruiter.count({ where: UNFINISHED_SIGNUP }),
      prisma.professional.count({ where: UNFINISHED_SIGNUP }),
      prisma.jobApplication.count({ where: { status: 'OFFER' } }),
    ]);

    // Success rate calculated from job applications
    const totalApps = applicationsCount;
    const successRate =
      totalApps > 0 ? `${Math.round((acceptedApps / totalApps) * 100)}%` : '0%';

    res.status(200).json({
      status: 'success',
      data: {
        activity: {
          jobsPosted: jobsCount,
          coursesPosted: coursesCount,
          applicationsSubmitted: applicationsCount,
          bookingsMade: bookingsCount,
          successRate,
        },
        userBreakdown: {
          providers: providersCount,
          recruiters: recruitersCount,
          professionals: professionalsCount,
          // Shown as a note so the totals reconcile with the Accounts page.
          unfinishedSignups:
            unfinishedRecruiterSignups + unfinishedProfessionalSignups,
        },
      },
    });
  },
);

/**
 * @desc    Get revenue overview
 * @route   GET /api/admin/dashboard/revenue
 * @access  Private (Admin)
 */
export const getRevenueOverview = catchAsync(
  async (req: CustomRequest, res: Response) => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const previousMonthStart = new Date(
      now.getFullYear(),
      now.getMonth() - 1,
      1,
    );

    const bookingSelect = {
      amountPaid: true,
      platformFee: true,
      trainerPayout: true,
      course: { select: { recruiterId: true } },
    };

    const [
      monthBookings,
      previousMonthBookings,
      outstandingBookings,
      monthRefunds,
      proProfessionals,
      premiumRecruiters,
    ] = await Promise.all([
      // Training-provider revenue is commission on course bookings, reported for
      // the current month.
      prisma.courseBooking.findMany({
        where: {
          paymentStatus: PaymentStatus.SUCCEEDED,
          paidAt: { gte: monthStart },
        },
        select: bookingSelect,
      }),
      prisma.courseBooking.findMany({
        where: {
          paymentStatus: PaymentStatus.SUCCEEDED,
          paidAt: { gte: previousMonthStart, lt: monthStart },
        },
        select: bookingSelect,
      }),
      // Payouts still owed are not month-scoped — they are whatever is unsettled.
      // Only provider courses are ever paid out.
      prisma.courseBooking.findMany({
        where: {
          paymentStatus: PaymentStatus.SUCCEEDED,
          course: { recruiterId: { not: null } },
        },
        select: { amountPaid: true, trainerPayout: true },
      }),
      prisma.courseBooking.aggregate({
        where: {
          paymentStatus: PaymentStatus.REFUNDED,
          updatedAt: { gte: monthStart },
        },
        _sum: { amountPaid: true },
      }),
      // While professionals are free (config/professionalMembership.ts) every
      // professional is on PRO, so only those actually paying count as
      // subscribers: Apple payers here, Stripe payers from Stripe below.
      prisma.professional.count({
        where: PROFESSIONALS_FREE_PRO
          ? { tier: 'PRO', appleOriginalTransactionId: { not: null } }
          : { tier: 'PRO' },
      }),
      prisma.recruiter.count({ where: { tier: 'PREMIUM' } }),
    ]);

    const sumCommission = (bookings: RevenueBooking[]) =>
      bookings.reduce((sum, b) => sum + platformShareOf(b), 0);

    const commissionRevenue = sumCommission(monthBookings);
    const previousCommissionRevenue = sumCommission(previousMonthBookings);
    const grossSales = monthBookings.reduce(
      (sum, b) => sum + Number(b.amountPaid),
      0,
    );
    // What the sales cost us: the providers' share of this month's bookings.
    const costOfSales = monthBookings.reduce(
      (sum, b) => sum + providerShareOf(b),
      0,
    );
    const pendingPayouts = outstandingBookings
      .filter((b) => !b.trainerPayout || Number(b.trainerPayout) === 0)
      .reduce((sum, b) => sum + payoutFor(Number(b.amountPaid)), 0);
    const refunds = Number(monthRefunds._sum.amountPaid || 0);

    // Subscription revenue lives in Stripe, not in our tables. If Stripe is
    // unreachable we still report the subscriber counts we own rather than
    // failing the whole dashboard card.
    let subscriptionRevenueSource: 'stripe' | 'unavailable' = 'stripe';
    let membershipRevenue = {
      professionals: { subscribers: proProfessionals, revenue: 0 },
      recruiters: { subscribers: premiumRecruiters, revenue: 0 },
      currency: 'GBP',
    };
    try {
      const stripeSummary = await stripeService.summarizeMembershipRevenue();
      membershipRevenue = {
        // Counts stay ours — a subscriber is someone holding a paid tier here.
        professionals: {
          subscribers: PROFESSIONALS_FREE_PRO
            ? proProfessionals + stripeSummary.professionals.subscribers
            : proProfessionals,
          revenue: stripeSummary.professionals.revenue,
        },
        recruiters: {
          subscribers: premiumRecruiters,
          revenue: stripeSummary.recruiters.revenue,
        },
        currency: stripeSummary.currency,
      };
    } catch (error) {
      subscriptionRevenueSource = 'unavailable';
      console.error('Failed to load Stripe membership revenue:', error);
    }

    const totalSubscriptionRevenue = round2(
      membershipRevenue.professionals.revenue +
        membershipRevenue.recruiters.revenue,
    );
    const totalSubscribers =
      membershipRevenue.professionals.subscribers +
      membershipRevenue.recruiters.subscribers;

    res.status(200).json({
      status: 'success',
      data: {
        overview: {
          // Subscription revenue only: training providers are commission-based
          // and reported separately below.
          totalRevenue: totalSubscriptionRevenue,
          totalSubscribers,
          activeSubscriptions: totalSubscribers,
          currency: membershipRevenue.currency,
          interval: 'month',
          source: subscriptionRevenueSource,
        },
        subscriptions: {
          professionals: {
            subscribers: membershipRevenue.professionals.subscribers,
            revenue: round2(membershipRevenue.professionals.revenue),
          },
          recruiters: {
            subscribers: membershipRevenue.recruiters.subscribers,
            revenue: round2(membershipRevenue.recruiters.revenue),
          },
        },
        training: {
          period: 'This Month',
          commissionRevenue: round2(commissionRevenue),
          growth: percentGrowth(commissionRevenue, previousCommissionRevenue),
          grossSales: round2(grossSales),
          costOfSales: round2(costOfSales),
          pendingPayouts: round2(pendingPayouts),
          refunds: round2(refunds),
        },
      },
    });
  },
);

/**
 * @desc    Get admin action queues (review queue and system alerts)
 * @route   GET /api/admin/dashboard/queues
 * @access  Private (Admin)
 */
export const getAdminActionQueues = catchAsync(
  async (req: CustomRequest, res: Response) => {
    // 1. Review Queue: the same items as the Pending Approvals card — account
    //    reviews and ID checks — newest first. The list holds the latest few
    //    of each; `reviewQueueTotal` is the real number waiting.
    const [
      pendingRecruiters,
      pendingProfessionals,
      pendingKyc,
      pendingRecruiterKyc,
      reviewQueueTotal,
    ] = await Promise.all([
      prisma.recruiter.findMany({
        where: AWAITING_ACCOUNT_REVIEW,
        take: REVIEW_QUEUE_PER_SOURCE,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          organizationName: true,
          createdAt: true,
          email: true,
        },
      }),
      prisma.professional.findMany({
        where: AWAITING_ACCOUNT_REVIEW,
        take: REVIEW_QUEUE_PER_SOURCE,
        orderBy: { createdAt: 'desc' },
        select: { id: true, fullname: true, email: true, createdAt: true },
      }),
      prisma.professionalKyc.findMany({
        where: { status: RecruiterStatus.PENDING },
        take: REVIEW_QUEUE_PER_SOURCE,
        orderBy: { createdAt: 'desc' },
        include: { professional: { select: { fullname: true } } },
      }),
      prisma.recruiterKyc.findMany({
        where: { status: RecruiterStatus.PENDING },
        take: REVIEW_QUEUE_PER_SOURCE,
        orderBy: { createdAt: 'desc' },
        include: {
          recruiter: { select: { organizationName: true, email: true } },
        },
      }),
      Promise.all([
        prisma.recruiter.count({ where: AWAITING_ACCOUNT_REVIEW }),
        prisma.professional.count({ where: AWAITING_ACCOUNT_REVIEW }),
        prisma.professionalKyc.count({ where: { status: 'PENDING' } }),
        prisma.recruiterKyc.count({ where: { status: 'PENDING' } }),
      ]).then((counts) => counts.reduce((sum, n) => sum + n, 0)),
    ]);

    const reviewQueue = [
      ...pendingRecruiters.map((r) => ({
        id: r.id,
        type: 'RECRUITER_VERIFICATION',
        title: r.organizationName || r.email,
        reason: 'Account review pending',
        timestamp: r.createdAt,
        severity: 'yellow',
      })),
      ...pendingProfessionals.map((p) => ({
        id: p.id,
        type: 'PROFESSIONAL_ACCOUNT',
        title: p.fullname || p.email,
        reason: 'Account review pending',
        timestamp: p.createdAt,
        severity: 'yellow',
      })),
      ...pendingKyc.map((k) => ({
        id: k.id,
        type: 'PROFESSIONAL_KYC',
        title: k.professional.fullname,
        reason: 'ID Verification Pending',
        timestamp: k.createdAt,
        severity: 'blue',
      })),
      ...pendingRecruiterKyc.map((k) => ({
        id: k.id,
        type: 'RECRUITER_KYC',
        title: k.recruiter.organizationName || k.recruiter.email,
        reason: 'ID Verification Pending',
        timestamp: k.createdAt,
        severity: 'blue',
      })),
    ].sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );

    // 2. System Alerts (real derived signals only). Failures are counted over
    //    a recent window so the alert clears once things are working again.
    const alertWindowStart = new Date(
      Date.now() - SYSTEM_ALERT_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );
    const recentFailure = {
      status: 'FAILED',
      createdAt: { gte: alertWindowStart },
    } as const;
    const [
      flaggedJobs,
      flaggedCourses,
      flaggedRecruiters,
      flaggedProfessionals,
      openReports,
      failedLogs,
      recentFailedLogs,
    ] = await Promise.all([
      prisma.job.count({ where: { isFlagged: true } }),
      prisma.course.count({ where: { isFlagged: true } }),
      prisma.recruiter.count({ where: { status: RecruiterStatus.FLAGGED } }),
      prisma.professional.count({ where: { status: 'FLAGGED' } }),
      prisma.userReport.count({ where: OPEN_USER_REPORT }),
      prisma.activityLog.count({ where: recentFailure }),
      prisma.activityLog.findMany({
        where: recentFailure,
        orderBy: { createdAt: 'desc' },
        take: 3,
        select: {
          id: true,
          action: true,
          actorType: true,
          createdAt: true,
        },
      }),
    ]);

    // Same total as the Flagged Issues card.
    const totalFlagged =
      openReports +
      flaggedJobs +
      flaggedCourses +
      flaggedRecruiters +
      flaggedProfessionals;

    const systemAlerts = [
      totalFlagged > 0
        ? {
            id: 'flagged-entities',
            type: 'SECURITY',
            message: `${totalFlagged} flagged item${totalFlagged === 1 ? ' needs' : 's need'} review.`,
            severity: 'red',
            timestamp: new Date(),
          }
        : null,
      failedLogs > 0
        ? {
            id: 'failed-activity-logs',
            type: 'OPERATIONS',
            message: `${failedLogs} failed platform action${failedLogs === 1 ? '' : 's'} in the last ${SYSTEM_ALERT_WINDOW_DAYS} days.`,
            severity: 'yellow',
            timestamp: new Date(),
          }
        : null,
      ...recentFailedLogs.map((log) => ({
        id: `failed-log-${log.id}`,
        type: 'OPERATIONS',
        message: `${log.action} failed (${log.actorType}).`,
        severity: 'yellow',
        timestamp: log.createdAt,
      })),
    ].filter(Boolean);

    res.status(200).json({
      status: 'success',
      data: {
        reviewQueue,
        reviewQueueTotal,
        systemAlerts,
      },
    });
  },
);

export const getPlatformActivityReport = catchAsync(
  async (req: CustomRequest, res: Response) => {
    const range = (req.query.range as string) || '7d';
    const startDate = getReportStartDate(range);
    const buckets = buildReportBuckets(range);

    const [weekly, traffic, logs] = await Promise.all([
      Promise.all(
        buckets.map(async (bucket) => {
          const [applications, jobs, courses] = await Promise.all([
            prisma.jobApplication.count({
              where: {
                createdAt: { gte: bucket.start, lt: bucket.end },
              },
            }),
            prisma.job.count({
              where: {
                createdAt: { gte: bucket.start, lt: bucket.end },
              },
            }),
            prisma.course.count({
              where: {
                createdAt: { gte: bucket.start, lt: bucket.end },
              },
            }),
          ]);

          return {
            day: bucket.label,
            Applications: applications,
            JobsPosted: jobs,
            Courses: courses,
          };
        }),
      ),
      Promise.all(
        buckets.map(async (bucket) => {
          const users = await prisma.activityLog.groupBy({
            by: ['actorId'],
            where: {
              createdAt: { gte: bucket.start, lt: bucket.end },
            },
          });

          return {
            time: bucket.label,
            users: users.length,
          };
        }),
      ),
      prisma.activityLog.findMany({
        where: { createdAt: { gte: startDate } },
        take: 100,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    res.status(200).json({
      status: 'success',
      data: {
        weekly,
        traffic,
        logs: logs.map((log) => ({
          id: log.id,
          eventType: log.action,
          user: `${log.actorType}${log.actorId ? ` ${log.actorId.slice(0, 8)}` : ''}`,
          timestamp: log.createdAt,
          status: log.status,
          statusColor: statusColor(log.status),
          raw: log,
        })),
      },
    });
  },
);

export const getTransactionHistory = catchAsync(
  async (req: CustomRequest, res: Response) => {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 25;
    const skip = (page - 1) * limit;
    const search = (req.query.search as string) || '';
    const status = req.query.status as string;
    const statusMap: Record<string, PaymentStatus> = {
      Completed: PaymentStatus.SUCCEEDED,
      Pending: PaymentStatus.PENDING,
      Failed: PaymentStatus.FAILED,
      Refunded: PaymentStatus.REFUNDED,
      SUCCEEDED: PaymentStatus.SUCCEEDED,
      PENDING: PaymentStatus.PENDING,
      FAILED: PaymentStatus.FAILED,
      REFUNDED: PaymentStatus.REFUNDED,
    };

    const where: Prisma.CourseBookingWhereInput = {
      ...(status && status !== 'All'
        ? { paymentStatus: statusMap[status] || undefined }
        : {}),
      ...(search
        ? {
            OR: [
              { id: { contains: search, mode: 'insensitive' as const } },
              {
                course: {
                  title: { contains: search, mode: 'insensitive' as const },
                },
              },
              {
                professional: {
                  email: { contains: search, mode: 'insensitive' as const },
                },
              },
              {
                course: {
                  recruiter: {
                    organizationName: {
                      contains: search,
                      mode: 'insensitive' as const,
                    },
                  },
                },
              },
            ],
          }
        : {}),
    };

    const [bookings, total] = await Promise.all([
      prisma.courseBooking.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          professional: {
            select: { fullname: true, email: true },
          },
          course: {
            select: {
              title: true,
              recruiter: {
                select: {
                  organizationName: true,
                  email: true,
                },
              },
            },
          },
        },
      }),
      prisma.courseBooking.count({ where }),
    ]);

    const transactions = bookings.map((booking) => {
      const statusLabel = transactionStatusLabel(booking.paymentStatus);
      const amount = Number(booking.amountPaid);
      return {
        id: booking.id,
        userCompany:
          booking.professional.fullname ||
          booking.professional.email ||
          booking.course.recruiter?.organizationName ||
          booking.course.recruiter?.email ||
          'Unknown',
        type: 'Course Purchase',
        date: booking.paidAt || booking.createdAt,
        status: statusLabel,
        statusColor: statusColor(booking.paymentStatus),
        amount,
        amountDisplay: `${booking.currency} ${amount.toFixed(2)}`,
        amountColor:
          booking.paymentStatus === 'FAILED'
            ? 'text-red-600'
            : 'text-green-600',
        course: booking.course.title,
        trainer:
          booking.course.recruiter?.organizationName ||
          booking.course.recruiter?.email ||
          null,
      };
    });

    res.status(200).json({
      status: 'success',
      results: transactions.length,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
      data: { transactions },
    });
  },
);

export const getAdminNotifications = catchAsync(
  async (req: CustomRequest, res: Response) => {
    const [pendingRecruiters, flaggedJobs, failedLogs, recentLogs] =
      await Promise.all([
        prisma.recruiter.count({ where: { status: 'PENDING' } }),
        prisma.job.count({ where: { isFlagged: true } }),
        prisma.activityLog.count({ where: { status: 'FAILED' } }),
        prisma.activityLog.findMany({
          take: 10,
          orderBy: { createdAt: 'desc' },
        }),
      ]);

    const notifications = [
      {
        id: 'admin-announcement',
        type: 'announcement',
        severity: 'info',
        title: 'Admin Dashboard Update',
        message:
          'Live activity reports, transaction history, and dashboard alerts are now connected to platform data.',
        createdAt: new Date(),
      },
      pendingRecruiters > 0
        ? {
            id: 'pending-recruiters',
            type: 'warning',
            severity: 'warning',
            title: 'Recruiter Reviews Pending',
            message: `${pendingRecruiters} recruiter accounts are waiting for review.`,
            createdAt: new Date(),
          }
        : null,
      flaggedJobs > 0
        ? {
            id: 'flagged-jobs',
            type: 'info',
            severity: 'info',
            title: 'Marketplace Review',
            message: `${flaggedJobs} job postings are flagged for manual review.`,
            createdAt: new Date(),
          }
        : null,
      failedLogs > 0
        ? {
            id: 'failed-activity',
            type: 'error',
            severity: 'error',
            title: 'Failed Platform Actions',
            message: `${failedLogs} failed activity log entries need attention.`,
            createdAt: new Date(),
          }
        : null,
      ...recentLogs.slice(0, 5).map((log) => ({
        id: log.id,
        type: log.status === 'FAILED' ? 'error' : 'success',
        severity: log.status === 'FAILED' ? 'error' : 'success',
        title: log.action,
        message: `${log.actorType} action ${log.status.toLowerCase()}.`,
        createdAt: log.createdAt,
      })),
    ].filter(Boolean);

    res.status(200).json({
      status: 'success',
      results: notifications.length,
      data: { notifications },
    });
  },
);
