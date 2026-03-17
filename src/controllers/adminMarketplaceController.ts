import { Response } from 'express';
import { prisma } from '../config/prisma.js';
import { catchAsync } from '../utils/catchAsync.js';
import { CustomRequest } from '../types/index.js';

/**
 * @desc    Get Marketplace Statistics for top cards
 * @route   GET /api/admin/marketplace/stats
 * @access  Private (Admin)
 */
export const getMarketplaceStats = catchAsync(
  async (req: CustomRequest, res: Response) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [
      liveJobs,
      jobsToday,
      totalApplications,
      appsToday,
      flaggedJobs,
      removedJobs,
      activeCourses,
      coursesToday,
      totalBookings,
      bookingsToday,
      flaggedCourses,
      upcomingSessions,
    ] = await Promise.all([
      // Jobs Stats
      prisma.job.count({ where: { status: 'ACTIVE' } }),
      prisma.job.count({
        where: { status: 'ACTIVE', createdAt: { gte: today } },
      }),
      prisma.jobApplication.count(),
      prisma.jobApplication.count({ where: { createdAt: { gte: today } } }),
      prisma.job.count({ where: { isFlagged: true } }),
      prisma.job.count({ where: { status: 'REMOVED' } }),

      // Courses Stats
      prisma.course.count({ where: { status: 'ACTIVE' } }),
      prisma.course.count({
        where: { status: 'ACTIVE', createdAt: { gte: today } },
      }),
      prisma.courseBooking.count(),
      prisma.courseBooking.count({ where: { createdAt: { gte: today } } }),
      prisma.course.count({ where: { isFlagged: true } }),
      prisma.courseSession.count({
        where: {
          startDate: {
            gte: new Date(),
            lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          },
        },
      }),
    ]);

    res.status(200).json({
      status: 'success',
      data: {
        jobs: {
          live: { count: liveJobs, today: jobsToday },
          applications: { count: totalApplications, today: appsToday },
          flagged: flaggedJobs,
          removed: removedJobs,
        },
        courses: {
          active: { count: activeCourses, today: coursesToday },
          bookings: { count: totalBookings, today: bookingsToday },
          flagged: flaggedCourses,
          upcomingSessions,
        },
      },
    });
  },
);

/**
 * @desc    Get Marketplace Oversight (Listing counts per provider/recruiter)
 * @route   GET /api/admin/marketplace/oversight
 * @access  Private (Admin)
 */
export const getMarketplaceOversight = catchAsync(
  async (req: CustomRequest, res: Response) => {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;
    const { type, search } = req.query; // type: JOBS or COURSES

    if (type === 'COURSES') {
      const providers = await prisma.recruiter.findMany({
        where: {
          role: 'TRAINING_AGENT',
          ...(search && {
            OR: [
              {
                organizationName: {
                  contains: search as string,
                  mode: 'insensitive',
                },
              },
              { email: { contains: search as string, mode: 'insensitive' } },
            ],
          }),
        },
        skip,
        take: limit,
        select: {
          id: true,
          organizationName: true,
          email: true,
          company: { select: { name: true } },
          _count: {
            select: {
              courses: true, // Total Posted
            },
          },
          courses: {
            select: {
              id: true,
              status: true,
              _count: { select: { bookings: true } },
              isFlagged: true,
              riskLevel: true,
            },
          },
        },
      });

      const formatted = providers.map((p) => {
        const activeCount = p.courses.filter(
          (c) => c.status === 'ACTIVE',
        ).length;
        const totalBookings = p.courses.reduce(
          (sum, c) => sum + (c._count.bookings || 0),
          0,
        );
        const flaggedCount = p.courses.filter((c) => c.isFlagged).length;
        const risks = p.courses.map((c) => c.riskLevel);
        const riskLevel = risks.includes('HIGH')
          ? 'HIGH'
          : risks.includes('MEDIUM')
            ? 'MEDIUM'
            : 'LOW';

        return {
          id: p.id,
          name: p.organizationName || p.email,
          company: p.company?.name || 'N/A',
          totalActive: activeCount,
          totalPosted: p._count.courses,
          totalInteractions: totalBookings,
          flaggedCount,
          riskLevel,
        };
      });

      const total = await prisma.recruiter.count({
        where: { role: 'TRAINING_AGENT' },
      });

      return res.status(200).json({
        status: 'success',
        total,
        data: { oversight: formatted },
      });
    }

    // Default to JOBS
    const recruiters = await prisma.recruiter.findMany({
      where: {
        role: 'RECRUITMENT_AGENT',
        ...(search && {
          OR: [
            {
              organizationName: {
                contains: search as string,
                mode: 'insensitive',
              },
            },
            { email: { contains: search as string, mode: 'insensitive' } },
          ],
        }),
      },
      skip,
      take: limit,
      select: {
        id: true,
        organizationName: true,
        email: true,
        company: { select: { name: true } },
        _count: {
          select: {
            jobs: true, // Total Posted
          },
        },
        jobs: {
          select: {
            id: true,
            status: true,
            _count: { select: { applications: true } },
            isFlagged: true,
            riskLevel: true,
          },
        },
      },
    });

    const formatted = recruiters.map((r) => {
      const activeCount = r.jobs.filter((j) => j.status === 'ACTIVE').length;
      const totalApps = r.jobs.reduce(
        (sum, j) => sum + (j._count.applications || 0),
        0,
      );
      const flaggedCount = r.jobs.filter((j) => j.isFlagged).length;
      const risks = r.jobs.map((j) => j.riskLevel);
      const riskLevel = risks.includes('HIGH')
        ? 'HIGH'
        : risks.includes('MEDIUM')
          ? 'MEDIUM'
          : 'LOW';

      return {
        id: r.id,
        name: r.organizationName || r.email,
        company: r.company?.name || 'N/A',
        totalActive: activeCount,
        totalPosted: r._count.jobs,
        totalInteractions: totalApps,
        flaggedCount,
        riskLevel,
      };
    });

    const total = await prisma.recruiter.count({
      where: { role: 'RECRUITMENT_AGENT' },
    });

    res.status(200).json({
      status: 'success',
      total,
      data: { oversight: formatted },
    });
  },
);

/**
 * @desc    Get MaritimeLink Listings (Internal Jobs/Courses)
 * @route   GET /api/admin/marketplace/listings
 * @access  Private (Admin)
 */
export const getMaritimeLinkListings = catchAsync(
  async (req: CustomRequest, res: Response) => {
    const { type } = req.query; // JOBS or COURSES

    if (type === 'COURSES') {
      const courses = await prisma.course.findMany({
        where: { adminId: { not: null } },
        include: {
          _count: { select: { bookings: true } },
        },
        orderBy: { createdAt: 'desc' },
      });

      return res.status(200).json({
        status: 'success',
        data: { listings: courses },
      });
    }

    const jobs = await prisma.job.findMany({
      where: { adminId: { not: null } },
      include: {
        _count: { select: { applications: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.status(200).json({
      status: 'success',
      data: { listings: jobs },
    });
  },
);
