import { Response, NextFunction } from 'express';
import { prisma } from '../config/prisma.js';
import { catchAsync } from '../utils/catchAsync.js';
import { AppError } from '../utils/AppError.js';
import { CustomRequest } from '../types/index.js';
import { createCourseSchema } from '../validations/jobValidation.js';

/**
 * Create a new course post
 */
export const createCourse = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const validatedData = createCourseSchema.parse(req.body);
    const userId = req.user?.id;
    const userRole = req.user?.role;

    if (!userId || !userRole) {
      return next(new AppError('User context missing', 400));
    }

    const isAdmin = ['SUPER_ADMIN', 'ADMIN', 'MODERATOR'].includes(userRole);

    const course = await prisma.course.create({
      data: {
        ...validatedData,
        adminId: isAdmin ? userId : null,
        recruiterId: !isAdmin ? userId : null,
      },
    });

    res.status(201).json({
      status: 'success',
      data: { course },
    });
  },
);

/**
 * Get all course posts
 */
export const getCourses = catchAsync(
  async (req: CustomRequest, res: Response) => {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    const courses = await prisma.course.findMany({
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

    const total = await prisma.course.count();

    res.status(200).json({
      status: 'success',
      results: courses.length,
      total,
      data: { courses },
    });
  },
);
