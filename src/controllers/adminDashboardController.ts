import { Response } from 'express';
import { prisma } from '../config/prisma.js';
import { catchAsync } from '../utils/catchAsync.js';
import { CustomRequest } from '../types/index.js';
import {
  DocumentCategory,
  PaymentStatus,
  Prisma,
  RecruiterStatus,
  VerificationStatus,
} from '../generated/client/index.js';

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

    // 1. Pending Approvals count (Recruiters + Professional KYC)
    const pendingRecruiters = await prisma.recruiter.count({
      where: { status: 'PENDING' },
    });
    const pendingProKyc = await prisma.professionalKyc.count({
      where: { status: 'PENDING' },
    });
    const pendingRecruiterKyc = await prisma.recruiterKyc.count({
      where: { status: 'PENDING' },
    });

    const pendingToday =
      (await prisma.recruiter.count({
        where: {
          status: 'PENDING',
          createdAt: { gte: todayStart },
        },
      })) +
      (await prisma.professionalKyc.count({
        where: {
          status: 'PENDING',
          createdAt: { gte: todayStart },
        },
      }));

    // 2. Flagged Issues count (Jobs + Courses + Users)
    const flaggedJobs = await prisma.job.count({ where: { isFlagged: true } });
    const flaggedCourses = await prisma.course.count({
      where: { isFlagged: true },
    });
    const flaggedRecruiters = await prisma.recruiter.count({
      where: { status: 'FLAGGED' },
    });
    const flaggedProfessionals = await prisma.professional.count({
      where: { status: 'FLAGGED' },
    });

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
            total: pendingRecruiters + pendingProKyc + pendingRecruiterKyc,
            today: pendingToday,
          },
          flaggedIssues:
            flaggedJobs +
            flaggedCourses +
            flaggedRecruiters +
            flaggedProfessionals,
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
    // Counts for overview
    const jobsCount = await prisma.job.count();
    const coursesCount = await prisma.course.count();
    const applicationsCount = await prisma.jobApplication.count();
    const bookingsCount = await prisma.courseBooking.count();

    // User breakdown
    const providersCount = await prisma.recruiter.count({
      where: { role: 'TRAINING_AGENT' },
    });
    const recruitersCount = await prisma.recruiter.count({
      where: { role: 'RECRUITMENT_AGENT' },
    });
    const professionalsCount = await prisma.professional.count();

    // Success rate calculated from job applications
    const totalApps = await prisma.jobApplication.count();
    const acceptedApps = await prisma.jobApplication.count({
      where: { status: 'OFFER' },
    });
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
    // Aggregate data from paid course bookings
    const [revenueAgg, paidBookings] = await Promise.all([
      prisma.courseBooking.aggregate({
        where: { paymentStatus: 'SUCCEEDED' },
        _sum: {
          amountPaid: true,
          platformFee: true,
          trainerPayout: true,
        },
      }),
      prisma.courseBooking.findMany({
        where: { paymentStatus: 'SUCCEEDED' },
        select: {
          amountPaid: true,
          trainerPayout: true,
        },
      }),
    ]);

    // Real active subscriptions check (users on a paid tier)
    const proPros = await prisma.professional.count({ where: { tier: 'PRO' } });
    const proRecs = await prisma.recruiter.count({
      where: { tier: 'PREMIUM' },
    });

    const grossRevenue = Number(revenueAgg._sum.amountPaid || 0);
    const platformRevenue = Number(revenueAgg._sum.platformFee || 0);
    const pendingPayouts = paidBookings
      .filter((b) => !b.trainerPayout || Number(b.trainerPayout) === 0)
      .reduce((sum, b) => sum + Number(b.amountPaid) * 0.82, 0);

    res.status(200).json({
      status: 'success',
      data: {
        overview: {
          activeSubscriptions: proPros + proRecs,
          // Platform earnings (what the platform has earned)
          totalRevenue: platformRevenue,
          growth: '+12.5%', // Growth still requires time-series calculation, keeping static for now
        },
        breakdown: {
          professionals: {
            amount: platformRevenue * 0.3,
            active: proPros,
            growth: '+8%',
          },
          recruiters: {
            amount: platformRevenue * 0.7,
            active: proRecs,
            growth: '+15%',
          },
        },
        training: {
          totalThisMonth: platformRevenue,
          growth: '+3.2%',
          sources: {
            // Keep gross sales visible as a source metric.
            courseSales: grossRevenue,
            pendingPayouts,
            refunds: 0,
          },
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
    // 1. Review Queue: Pending recruiters and KYC
    const pendingRecruiters = await prisma.recruiter.findMany({
      where: { status: RecruiterStatus.PENDING },
      take: 5,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        organizationName: true,
        createdAt: true,
        email: true,
      },
    });

    const pendingKyc = await prisma.professionalKyc.findMany({
      where: { status: RecruiterStatus.PENDING },
      take: 5,
      orderBy: { createdAt: 'desc' },
      include: { professional: { select: { fullname: true } } },
    });

    const reviewQueue = [
      ...pendingRecruiters.map((r) => ({
        id: r.id,
        type: 'RECRUITER_VERIFICATION',
        title: r.organizationName || r.email,
        reason: 'Verification Pending',
        timestamp: r.createdAt,
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
    ].sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );

    // 2. System Alerts (real derived signals only)
    const [
      flaggedJobs,
      flaggedCourses,
      flaggedRecruiters,
      flaggedProfessionals,
      failedLogs,
      recentFailedLogs,
    ] = await Promise.all([
      prisma.job.count({ where: { isFlagged: true } }),
      prisma.course.count({ where: { isFlagged: true } }),
      prisma.recruiter.count({ where: { status: RecruiterStatus.FLAGGED } }),
      prisma.professional.count({ where: { status: 'FLAGGED' } }),
      prisma.activityLog.count({ where: { status: 'FAILED' } }),
      prisma.activityLog.findMany({
        where: { status: 'FAILED' },
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

    const totalFlagged =
      flaggedJobs + flaggedCourses + flaggedRecruiters + flaggedProfessionals;

    const systemAlerts = [
      totalFlagged > 0
        ? {
            id: 'flagged-entities',
            type: 'SECURITY',
            message: `${totalFlagged} flagged item${totalFlagged === 1 ? '' : 's'} need review.`,
            severity: 'red',
            timestamp: new Date(),
          }
        : null,
      failedLogs > 0
        ? {
            id: 'failed-activity-logs',
            type: 'OPERATIONS',
            message: `${failedLogs} failed platform action${failedLogs === 1 ? '' : 's'} detected.`,
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
