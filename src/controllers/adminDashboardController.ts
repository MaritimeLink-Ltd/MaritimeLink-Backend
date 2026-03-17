import { Response } from 'express';
import { prisma } from '../config/prisma.js';
import { catchAsync } from '../utils/catchAsync.js';
import { CustomRequest } from '../types/index.js';
import { RecruiterStatus } from '../generated/client/index.js';

/**
 * @desc    Get admin dashboard stats (top cards)
 * @route   GET /api/admin/dashboard/stats
 * @access  Private (Admin)
 */
export const getAdminDashboardStats = catchAsync(
  async (req: CustomRequest, res: Response) => {
    const now = new Date();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

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

    // 3. Expiring Compliance count (Professional documents expiring soon)
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(now.getDate() + 30);
    const expiringCompliance = await prisma.professionalDocument.count({
      where: { expiryDate: { lte: thirtyDaysFromNow, gte: now } },
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
            count: expiringCompliance,
            timeframe: '30d',
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
    // Aggregate data from CourseBooking
    const revenueAgg = await prisma.courseBooking.aggregate({
      where: { paymentStatus: 'SUCCEEDED' },
      _sum: {
        amountPaid: true,
        platformFee: true,
        trainerPayout: true,
      },
    });

    // Real active subscriptions check (users with tier PRO)
    const proPros = await prisma.professional.count({ where: { tier: 'PRO' } });
    const proRecs = await prisma.recruiter.count({ where: { tier: 'PRO' } });

    const totalRevenue = Number(revenueAgg._sum.amountPaid || 0);

    res.status(200).json({
      status: 'success',
      data: {
        overview: {
          activeSubscriptions: proPros + proRecs,
          totalRevenue,
          growth: '+12.5%', // Growth still requires time-series calculation, keeping static for now
        },
        breakdown: {
          professionals: {
            amount: totalRevenue * 0.3,
            active: proPros,
            growth: '+8%',
          },
          recruiters: {
            amount: totalRevenue * 0.7,
            active: proRecs,
            growth: '+15%',
          },
        },
        training: {
          totalThisMonth: totalRevenue,
          growth: '+3.2%',
          sources: {
            courseSales: totalRevenue,
            pendingPayouts: Number(revenueAgg._sum.trainerPayout || 0),
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

    // 2. System Alerts (Mocked/Derived from logs if available)
    const systemAlerts = [
      {
        type: 'SECURITY',
        message: 'Multiple accounts flagged',
        severity: 'red',
        timestamp: new Date(),
      },
      {
        type: 'TRAFFIC',
        message: 'Unusual spike in new registrations',
        severity: 'yellow',
        timestamp: new Date(),
      },
      {
        type: 'MAINTENANCE',
        message: 'System maintenance scheduled',
        severity: 'blue',
        timestamp: new Date(),
      },
      {
        type: 'latency',
        message: 'Payment gateway latency',
        severity: 'yellow',
        timestamp: new Date(),
      },
    ];

    res.status(200).json({
      status: 'success',
      data: {
        reviewQueue,
        systemAlerts,
      },
    });
  },
);
