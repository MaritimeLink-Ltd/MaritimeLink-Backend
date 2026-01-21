import { Response, NextFunction } from 'express';
import { prisma } from '../config/prisma.js';
import { catchAsync } from '../utils/catchAsync.js';
import { AppError } from '../utils/AppError.js';
import { CustomRequest } from '../types/index.js';
import { createJobSchema } from '../validations/jobValidation.js';

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
 * Get all job posts
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
