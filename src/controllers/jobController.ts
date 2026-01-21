import { Response, NextFunction } from 'express';
import { prisma } from '../config/prisma.js';
import { catchAsync } from '../utils/catchAsync.js';
import { AppError } from '../utils/AppError.js';
import { CustomRequest } from '../types/index.js';
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

    const job = await prisma.job.create({
      data: {
        ...validatedData,
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
 * Get all job posts (Public)
 */
export const getJobs = catchAsync(async (req: CustomRequest, res: Response) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const skip = (page - 1) * limit;

  const jobs = await prisma.job.findMany({
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

  const total = await prisma.job.count();

  res.status(200).json({
    status: 'success',
    results: jobs.length,
    total,
    data: { jobs },
  });
});

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

    const updatedJob = await prisma.job.update({
      where: { id },
      data: validatedData,
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
