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
      where: { status: RecruiterStatus.PENDING },
    });
    const pendingKyc = await prisma.professionalKyc.count({
      where: { status: RecruiterStatus.PENDING },
    });
    const pendingToday =
      (await prisma.recruiter.count({
        where: {
          status: RecruiterStatus.PENDING,
          createdAt: { gte: todayStart },
        },
      })) +
      (await prisma.professionalKyc.count({
        where: {
          status: RecruiterStatus.PENDING,
          createdAt: { gte: todayStart },
        },
      }));

    // 2. Flagged Issues count (Jobs + Courses)
    const flaggedJobs = await prisma.job.count({ where: { isFlagged: true } });
    const flaggedCourses = await prisma.course.count({
      where: { isFlagged: true },
    });

    // 3. Expiring Compliance count (Professional documents in next 48h)
    const fortyEightHoursFromNow = new Date();
    fortyEightHoursFromNow.setHours(now.getHours() + 48);
    const expiringCompliance = await prisma.professionalDocument.count({
      where: { expiryDate: { lte: fortyEightHoursFromNow, gte: now } },
    });

    res.status(200).json({
      status: 'success',
      data: {
        stats: {
          pendingApprovals: {
            total: pendingRecruiters + pendingKyc,
            today: pendingToday,
          },
          flaggedIssues: flaggedJobs + flaggedCourses,
          expiringCompliance: {
            count: expiringCompliance,
            timeframe: '48h',
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

    // Mock data for things not directly in schema yet
    const successRate = '85%'; // Heuristic or mock

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
      _sum: {
        amountPaid: true,
        platformFee: true,
        trainerPayout: true,
      },
    });

    // Mock/Hardcoded values based on user requirements for specific display
    const activeSubscriptions = 1250;
    const totalRevenue = 425000;
    const growth = '+12.5%';
    const trainingGrowth = '+3.2%';
    const proGrowth = '+8%';
    const recGrowth = '+15%';

    const trainingRevenueMonth = Number(revenueAgg._sum.amountPaid || 0);

    res.status(200).json({
      status: 'success',
      data: {
        overview: {
          activeSubscriptions,
          totalRevenue,
          growth,
        },
        breakdown: {
          professionals: { amount: 125000, active: 1000, growth: proGrowth },
          recruiters: { amount: 300000, active: 50, growth: recGrowth },
        },
        training: {
          totalThisMonth: trainingRevenueMonth,
          growth: trainingGrowth,
          sources: {
            courseSales: trainingRevenueMonth,
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
