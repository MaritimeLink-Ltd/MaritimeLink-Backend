import { Response, NextFunction } from 'express';
import { prisma } from '../config/prisma.js';
import { Prisma, JobCategory, JobType } from '../generated/client/index.js';
import { catchAsync } from '../utils/catchAsync.js';
import { AppError } from '../utils/AppError.js';
import { CustomRequest } from '../types/index.js';
import { logActivity } from '../services/activityLogger.js';
import { ActorType } from '../generated/client/index.js';
import {
  createJobSchema,
  updateJobSchema,
} from '../validations/jobValidation.js';

/**
 * Create a new job post
 */
export const createJob = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const validatedData = createJobSchema.parse(req.body);
    const userId = req.user?.id;
    const userRole = req.user?.role;

    if (!userId || !userRole) {
      return next(new AppError('User context missing', 400));
    }

    // Admins have specific roles
    const isAdmin = ['SUPER_ADMIN', 'ADMIN', 'MODERATOR'].includes(userRole);

    const { closingDate } = validatedData;
    const job = await prisma.job.create({
      data: {
        ...validatedData,
        closingDate: closingDate ? new Date(closingDate) : null,
        adminId: isAdmin ? userId : null,
        recruiterId: !isAdmin ? userId : null,
      },
    });

    res.status(201).json({
      status: 'success',
      data: { job },
    });
  },
);

/**
 * Get all job posts (Public with Filters)
 */
export const getJobs = catchAsync(async (req: CustomRequest, res: Response) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const skip = (page - 1) * limit;

  const { category, jobType, datePosted } = req.query;

  // Build filters
  const where: Prisma.JobWhereInput = {};

  if (category) {
    where.category = category as JobCategory;
  }

  if (jobType) {
    where.contractType = jobType as JobType;
  }

  if (datePosted) {
    const now = new Date();
    if (datePosted === '24h') {
      where.createdAt = { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) };
    } else if (datePosted === '7d') {
      where.createdAt = {
        gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
      };
    } else if (datePosted === '30d') {
      where.createdAt = {
        gte: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
      };
    }
  }

  // Check filters before query

  // Default: Exclude Flagged Jobs from public feed unless requested by Admin?
  // Or filter logic: if not admin, isFlagged: false.
  // We can't easily check 'admin' context here without passing it down or assuming public.
  // Generally, public feeds should NOT show flagged jobs.
  if (!where.isFlagged) {
    where.isFlagged = false;
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
    },
    orderBy: { createdAt: 'desc' },
  });

  const total = await prisma.job.count({ where });

  res.status(200).json({
    status: 'success',
    results: jobs.length,
    total,
    data: { jobs },
  });
});

/**
 * Get a single job by ID
 */
export const getJobById = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const { id } = req.params;

    const job = await prisma.job.findUnique({
      where: { id },
      include: {
        recruiter: {
          select: {
            organizationName: true,
            email: true,
            website: true,
            address: true,
          },
        },
        admin: {
          select: { email: true },
        },
      },
    });

    if (!job) {
      return next(new AppError('Job not found', 404));
    }

    res.status(200).json({
      status: 'success',
      data: { job },
    });
  },
);

/**
 * Get jobs created by current user
 */
export const getMyJobs = catchAsync(
  async (req: CustomRequest, res: Response) => {
    const userId = req.user?.id;
    const userRole = req.user?.role;

    const isAdmin = ['SUPER_ADMIN', 'ADMIN', 'MODERATOR'].includes(
      userRole || '',
    );

    const jobs = await prisma.job.findMany({
      where: isAdmin ? { adminId: userId } : { recruiterId: userId },
      orderBy: { createdAt: 'desc' },
    });

    res.status(200).json({
      status: 'success',
      results: jobs.length,
      data: { jobs },
    });
  },
);

/**
 * Update a job post
 */
export const updateJob = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const { id } = req.params;
    const validatedData = updateJobSchema.parse(req.body);
    const userId = req.user?.id;
    const userRole = req.user?.role;

    const isAdmin = ['SUPER_ADMIN', 'ADMIN', 'MODERATOR'].includes(
      userRole || '',
    );

    const job = await prisma.job.findUnique({
      where: { id },
    });

    if (!job) {
      return next(new AppError('Job not found', 404));
    }

    // Ownership check
    if (isAdmin) {
      if (job.adminId !== userId)
        return next(new AppError('Unauthorized', 403));
    } else {
      if (job.recruiterId !== userId)
        return next(new AppError('Unauthorized', 403));
    }

    const { closingDate } = validatedData;
    const updatedJob = await prisma.job.update({
      where: { id },
      data: {
        ...validatedData,
        closingDate: closingDate ? new Date(closingDate) : undefined,
      },
    });

    res.status(200).json({
      status: 'success',
      data: { job: updatedJob },
    });
  },
);

/**
 * Delete a job post
 */
export const deleteJob = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const { id } = req.params;
    const userId = req.user?.id;
    const userRole = req.user?.role;

    const isAdmin = ['SUPER_ADMIN', 'ADMIN', 'MODERATOR'].includes(
      userRole || '',
    );

    const job = await prisma.job.findUnique({
      where: { id },
    });

    if (!job) {
      return next(new AppError('Job not found', 404));
    }

    // Ownership check
    if (isAdmin) {
      if (job.adminId !== userId)
        return next(new AppError('Unauthorized', 403));
    } else {
      if (job.recruiterId !== userId)
        return next(new AppError('Unauthorized', 403));
    }

    await prisma.job.delete({
      where: { id },
    });

    res.status(204).json({
      status: 'success',
      data: null,
    });
  },
);

/**
 * Admin: Get Flagged Jobs
 */
export const getFlaggedJobs = catchAsync(
  async (req: CustomRequest, res: Response) => {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    const jobs = await prisma.job.findMany({
      where: { isFlagged: true },
      skip,
      take: limit,
      include: {
        recruiter: { select: { organizationName: true, email: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });

    const total = await prisma.job.count({ where: { isFlagged: true } });

    res.status(200).json({
      status: 'success',
      results: jobs.length,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      data: { jobs },
    });
  },
);

/**
 * Admin: Toggle Job Flag (Moderation)
 */
export const toggleJobFlag = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const { id } = req.params;

    const job = await prisma.job.findUnique({ where: { id } });
    if (!job) return next(new AppError('Job not found', 404));

    const updatedJob = await prisma.job.update({
      where: { id },
      data: { isFlagged: !job.isFlagged },
    });

    // Log moderation action
    await logActivity({
      action: updatedJob.isFlagged ? 'JOB_FLAGGED' : 'JOB_UNFLAGGED',
      actorId: req.user!.id,
      actorType: ActorType.ADMIN,
      targetId: job.id,
      targetType: 'Job',
      status: 'SUCCESS',
    });

    res.status(200).json({
      status: 'success',
      message: updatedJob.isFlagged
        ? 'Job is now flagged and hidden from main feed.'
        : 'Job unflagged.',
      data: { job: updatedJob },
    });
  },
);
