import { Response, NextFunction } from 'express';
import { prisma } from '../config/prisma.js';
import {
  Prisma,
  JobCategory,
  JobStatus,
  CourseStatus,
  CourseType,
} from '../generated/client/index.js';
import { catchAsync } from '../utils/catchAsync.js';
import { CustomRequest } from '../types/index.js';
import { Readable } from 'stream';
import csv from 'csv-parser';
import { AppError } from '../utils/AppError.js';
import { JobType } from '../generated/client/index.js';

const resolveTimeframeStart = (timeframe?: string) => {
  const now = new Date();
  const start = new Date(now);
  const normalized = String(timeframe || '30d').toLowerCase();

  if (normalized === 'today') {
    start.setHours(0, 0, 0, 0);
    return start;
  }

  if (normalized === '7d' || normalized === '7days') {
    start.setDate(now.getDate() - 7);
    return start;
  }

  start.setDate(now.getDate() - 30);
  return start;
};

type MarketplaceOversightRow = {
  id: string;
  name: string;
  email: string;
  company: string;
  totalActive: number;
  totalPosted: number;
  totalInteractions: number;
  flaggedCount: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
};

/**
 * @desc    Get Marketplace Statistics for top cards
 * @route   GET /api/admin/marketplace/stats
 * @access  Private (Admin)
 */
export const getMarketplaceStats = catchAsync(
  async (req: CustomRequest, res: Response) => {
    const timeframeStart = resolveTimeframeStart(req.query.timeframe as string);

    const [
      liveJobs,
      jobsInWindow,
      totalApplications,
      appsInWindow,
      flaggedJobs,
      removedJobs,
      activeCourses,
      coursesInWindow,
      totalBookings,
      bookingsInWindow,
      flaggedCourses,
      upcomingSessions,
    ] = await Promise.all([
      // Jobs Stats
      prisma.job.count({ where: { status: 'ACTIVE' } }),
      prisma.job.count({
        where: { status: 'ACTIVE', createdAt: { gte: timeframeStart } },
      }),
      prisma.jobApplication.count(),
      prisma.jobApplication.count({
        where: { createdAt: { gte: timeframeStart } },
      }),
      prisma.job.count({ where: { isFlagged: true } }),
      prisma.job.count({
        where: {
          status: {
            in: [JobStatus.REMOVED, JobStatus.EXPIRED, JobStatus.FILLED],
          },
        },
      }),

      // Courses Stats
      prisma.course.count({ where: { status: 'ACTIVE' } }),
      prisma.course.count({
        where: { status: 'ACTIVE', createdAt: { gte: timeframeStart } },
      }),
      prisma.courseBooking.count(),
      prisma.courseBooking.count({
        where: { createdAt: { gte: timeframeStart } },
      }),
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
          live: { count: liveJobs, today: jobsInWindow },
          applications: { count: totalApplications, today: appsInWindow },
          flagged: flaggedJobs,
          removed: removedJobs,
        },
        courses: {
          active: { count: activeCourses, today: coursesInWindow },
          bookings: { count: totalBookings, today: bookingsInWindow },
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
    const { type, search, status, riskLevel } = req.query; // type: JOBS or COURSES

    if (type === 'COURSES') {
      const courseWhere: Prisma.CourseWhereInput = {
        recruiterId: { not: null },
        ...(search && {
          OR: [
            { title: { contains: search as string, mode: 'insensitive' } },
            { location: { contains: search as string, mode: 'insensitive' } },
            {
              recruiter: {
                organizationName: {
                  contains: search as string,
                  mode: 'insensitive',
                },
              },
            },
            {
              recruiter: {
                email: { contains: search as string, mode: 'insensitive' },
              },
            },
          ],
        }),
      };
      const courses = await prisma.course.findMany({
        where: courseWhere,
        include: {
          recruiter: {
            select: {
              id: true,
              organizationName: true,
              email: true,
              company: { select: { name: true } },
            },
          },
          _count: { select: { bookings: true } },
        },
      });

      const grouped = new Map<string, MarketplaceOversightRow>();
      courses.forEach((course) => {
        if (!course.recruiterId || !course.recruiter) return;
        const current = grouped.get(course.recruiterId) || {
          id: course.recruiterId,
          name: course.recruiter.organizationName || course.recruiter.email,
          email: course.recruiter.email,
          company: course.recruiter.company?.name || 'N/A',
          totalActive: 0,
          totalPosted: 0,
          totalInteractions: 0,
          flaggedCount: 0,
          riskLevel: 'LOW',
        };

        current.totalPosted += 1;
        current.totalInteractions += course._count.bookings || 0;
        if (course.status === 'ACTIVE') current.totalActive += 1;
        if (course.isFlagged) current.flaggedCount += 1;
        if (course.riskLevel === 'HIGH') current.riskLevel = 'HIGH';
        else if (course.riskLevel === 'MEDIUM' && current.riskLevel !== 'HIGH')
          current.riskLevel = 'MEDIUM';

        grouped.set(course.recruiterId, current);
      });

      let formatted = Array.from(grouped.values());
      if (typeof status === 'string' && status.length > 0) {
        if (status === 'FLAGGED') {
          formatted = formatted.filter((row) => row.flaggedCount > 0);
        } else if (status === 'ACTIVE') {
          formatted = formatted.filter((row) => row.totalActive > 0);
        } else if (status === 'CLOSED') {
          formatted = formatted.filter(
            (row) => row.totalActive === 0 && row.totalPosted > 0,
          );
        }
      }
      if (typeof riskLevel === 'string' && riskLevel.length > 0) {
        formatted = formatted.filter(
          (row) => (row.riskLevel || 'LOW').toUpperCase() === riskLevel,
        );
      }
      formatted.sort((a, b) => a.name.localeCompare(b.name));
      const total = formatted.length;
      const paged = formatted.slice(skip, skip + limit);

      return res.status(200).json({
        status: 'success',
        total,
        pagination: {
          page,
          limit,
          total,
          pages: Math.max(1, Math.ceil(total / limit)),
        },
        data: { oversight: paged },
      });
    }

    // Default to JOBS
    const jobWhere: Prisma.JobWhereInput = {
      recruiterId: { not: null },
      ...(search && {
        OR: [
          { title: { contains: search as string, mode: 'insensitive' } },
          { location: { contains: search as string, mode: 'insensitive' } },
          {
            recruiter: {
              organizationName: {
                contains: search as string,
                mode: 'insensitive',
              },
            },
          },
          {
            recruiter: {
              email: { contains: search as string, mode: 'insensitive' },
            },
          },
          {
            recruiter: {
              company: {
                name: { contains: search as string, mode: 'insensitive' },
              },
            },
          },
        ],
      }),
    };
    const jobs = await prisma.job.findMany({
      where: jobWhere,
      include: {
        recruiter: {
          select: {
            id: true,
            organizationName: true,
            email: true,
            company: { select: { name: true } },
          },
        },
        _count: {
          select: {
            applications: true,
          },
        },
      },
    });

    const grouped = new Map<string, MarketplaceOversightRow>();
    jobs.forEach((job) => {
      if (!job.recruiterId || !job.recruiter) return;
      const current = grouped.get(job.recruiterId) || {
        id: job.recruiterId,
        name: job.recruiter.organizationName || job.recruiter.email,
        email: job.recruiter.email,
        company: job.recruiter.company?.name || 'N/A',
        totalActive: 0,
        totalPosted: 0,
        totalInteractions: 0,
        flaggedCount: 0,
        riskLevel: 'LOW',
      };

      current.totalPosted += 1;
      current.totalInteractions += job._count.applications || 0;
      if (job.status === 'ACTIVE') current.totalActive += 1;
      if (job.isFlagged) current.flaggedCount += 1;
      if (job.riskLevel === 'HIGH') current.riskLevel = 'HIGH';
      else if (job.riskLevel === 'MEDIUM' && current.riskLevel !== 'HIGH')
        current.riskLevel = 'MEDIUM';

      grouped.set(job.recruiterId, current);
    });

    let formatted = Array.from(grouped.values());
    if (typeof status === 'string' && status.length > 0) {
      if (status === 'FLAGGED') {
        formatted = formatted.filter((row) => row.flaggedCount > 0);
      } else if (status === 'ACTIVE') {
        formatted = formatted.filter((row) => row.totalActive > 0);
      } else if (status === 'CLOSED') {
        formatted = formatted.filter(
          (row) => row.totalActive === 0 && row.totalPosted > 0,
        );
      }
    }
    if (typeof riskLevel === 'string' && riskLevel.length > 0) {
      formatted = formatted.filter(
        (row) => (row.riskLevel || 'LOW').toUpperCase() === riskLevel,
      );
    }
    formatted.sort((a, b) => a.name.localeCompare(b.name));
    const total = formatted.length;
    const paged = formatted.slice(skip, skip + limit);

    res.status(200).json({
      status: 'success',
      total,
      pagination: {
        page,
        limit,
        total,
        pages: Math.max(1, Math.ceil(total / limit)),
      },
      data: { oversight: paged },
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
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;
    const search = req.query.search as string | undefined;
    const status = req.query.status as string | undefined;

    if (type === 'COURSES') {
      const where: Prisma.CourseWhereInput = {
        adminId: { not: null },
      };
      if (search) {
        where.OR = [
          { title: { contains: search, mode: 'insensitive' } },
          { location: { contains: search, mode: 'insensitive' } },
        ];
      }
      if (status === 'FLAGGED') where.isFlagged = true;
      else if (status) where.status = status as CourseStatus;

      const courses = await prisma.course.findMany({
        where,
        skip,
        take: limit,
        include: {
          _count: { select: { bookings: true } },
        },
        orderBy: { createdAt: 'desc' },
      });
      const total = await prisma.course.count({ where });

      return res.status(200).json({
        status: 'success',
        pagination: {
          page,
          limit,
          total,
          pages: Math.max(1, Math.ceil(total / limit)),
        },
        data: { listings: courses, total },
      });
    }

    const where: Prisma.JobWhereInput = {
      adminId: { not: null },
    };
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { location: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (status === 'FLAGGED') where.isFlagged = true;
    else if (status === 'CLOSED') {
      where.status = {
        in: [JobStatus.REMOVED, JobStatus.EXPIRED, JobStatus.FILLED],
      };
    } else if (status) {
      where.status = status as JobStatus;
    }

    const jobs = await prisma.job.findMany({
      where,
      skip,
      take: limit,
      include: {
        _count: { select: { applications: true } },
        recruiter: {
          select: { organizationName: true, email: true },
        },
        admin: {
          select: { email: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    const total = await prisma.job.count({ where });

    res.status(200).json({
      status: 'success',
      pagination: {
        page,
        limit,
        total,
        pages: Math.max(1, Math.ceil(total / limit)),
      },
      data: { listings: jobs, total },
    });
  },
);

/**
 * @desc    Get all jobs for Admin specifically (includes flagged, non-flagged)
 * @route   GET /api/admin/jobs
 * @access  Private (Admin)
 */
export const getAllJobsForAdmin = catchAsync(
  async (req: CustomRequest, res: Response) => {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    const { category, status, isFlagged, search, recruiterId, companyId } =
      req.query as {
        category?: string;
        status?: string;
        isFlagged?: string;
        search?: string;
        recruiterId?: string;
        companyId?: string;
      };

    const where: Prisma.JobWhereInput = {};

    if (category) where.category = category as JobCategory;
    if (status) where.status = status as JobStatus;
    if (isFlagged !== undefined) where.isFlagged = isFlagged === 'true';
    if (recruiterId) where.recruiterId = recruiterId;
    if (companyId) where.companyId = companyId;
    if (search) {
      where.OR = [
        { title: { contains: search as string, mode: 'insensitive' } },
        { location: { contains: search as string, mode: 'insensitive' } },
      ];
    }

    const jobs = await prisma.job.findMany({
      where,
      skip,
      take: limit,
      include: {
        recruiter: {
          select: { organizationName: true, email: true },
        },
        admin: {
          select: { email: true },
        },
        _count: {
          select: { applications: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const total = await prisma.job.count({ where });

    res.status(200).json({
      status: 'success',
      results: jobs.length,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      data: { jobs },
    });
  },
);

/**
 * @desc    Get a specific job by ID for Admin
 * @route   GET /api/admin/jobs/:id
 * @access  Private (Admin)
 */
export const getJobByIdForAdmin = catchAsync(
  async (req: CustomRequest, res: Response) => {
    const { id } = req.params;

    const job = await prisma.job.findUnique({
      where: { id },
      include: {
        recruiter: {
          select: {
            id: true,
            organizationName: true,
            email: true,
            website: true,
            address: true,
          },
        },
        admin: {
          select: { id: true, email: true },
        },
        _count: {
          select: { applications: true, savedBy: true },
        },
      },
    });

    if (!job) {
      return res
        .status(404)
        .json({ status: 'error', message: 'Job not found' });
    }

    res.status(200).json({
      status: 'success',
      data: { job },
    });
  },
);

/**
 * @desc    Get all courses for Admin specifically (includes flagged, non-flagged)
 * @route   GET /api/admin/courses
 * @access  Private (Admin)
 */
export const getAllCoursesForAdmin = catchAsync(
  async (req: CustomRequest, res: Response) => {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    const { status, isFlagged, search, recruiterId, companyId, type } =
      req.query as {
        status?: string;
        isFlagged?: string;
        search?: string;
        recruiterId?: string;
        companyId?: string;
        type?: string;
      };

    const where: Prisma.CourseWhereInput = {};

    if (status) where.status = status as CourseStatus;
    if (isFlagged !== undefined) where.isFlagged = isFlagged === 'true';
    if (recruiterId) where.recruiterId = recruiterId;
    if (companyId) where.companyId = companyId;
    if (type) where.courseType = type as CourseType;

    if (search) {
      where.OR = [
        { title: { contains: search as string, mode: 'insensitive' } },
        { location: { contains: search as string, mode: 'insensitive' } },
      ];
    }

    const courses = await prisma.course.findMany({
      where,
      skip,
      take: limit,
      include: {
        recruiter: {
          select: { organizationName: true, email: true },
        },
        admin: {
          select: { email: true },
        },
        _count: {
          select: { bookings: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const total = await prisma.course.count({ where });

    res.status(200).json({
      status: 'success',
      results: courses.length,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      data: { courses },
    });
  },
);

/**
 * @desc    Bulk Upload Jobs via CSV
 * @route   POST /api/admin/jobs/bulk-upload
 * @access  Private (Admin)
 */
export const bulkUploadJobs = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    if (!req.file) {
      return next(new AppError('Please upload a CSV file', 400));
    }

    const results: Record<string, string>[] = [];
    const stream = Readable.from(req.file.buffer);

    await new Promise((resolve, reject) => {
      stream
        .pipe(csv())
        .on('data', (data) => results.push(data))
        .on('end', resolve)
        .on('error', reject);
    });

    if (results.length === 0) {
      return next(new AppError('CSV file is empty', 400));
    }

    const adminId = req.user?.id;
    if (!adminId)
      return next(new AppError('Admin ID not found in request', 401));

    // Map and validate rows
    const jobsData = results.map((row) => {
      // Basic validation for required fields
      if (!row.title || !row.location || !row.category || !row.description) {
        throw new AppError('Missing required fields in one or more rows', 400);
      }

      return {
        title: row.title,
        location: row.location,
        category: row.category as JobCategory,
        contractType: (row.contractType as JobType) || JobType.PERMANENT,
        salary: row.salary || 'Competitive',
        description: row.description,
        adminId: adminId,
        status: JobStatus.ACTIVE,
      };
    });

    // Create jobs in bulk
    await prisma.job.createMany({
      data: jobsData,
    });

    res.status(201).json({
      status: 'success',
      message: `${jobsData.length} jobs uploaded successfully`,
      count: jobsData.length,
    });
  },
);

/**
 * @desc    Get Bulk Upload CSV Sample
 * @route   GET /api/admin/jobs/bulk-upload/sample
 * @access  Private (Admin)
 */
export const getBulkUploadSample = catchAsync(
  async (req: CustomRequest, res: Response) => {
    const headers = 'title,location,category,contractType,salary,description';
    const sample =
      'Full-Stack Web Developer,Middle East,OFFICER,PERMANENT,50000,Minimum 5 years of experience';

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename=jobs_sample.csv',
    );

    res.status(200).send(`${headers}\n${sample}`);
  },
);
