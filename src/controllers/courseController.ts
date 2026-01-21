import { Response, NextFunction } from 'express';
import { prisma } from '../config/prisma.js';
import { catchAsync } from '../utils/catchAsync.js';
import { AppError } from '../utils/AppError.js';
import { CustomRequest } from '../types/index.js';
import {
  createCourseSchema,
  updateCourseSchema,
} from '../validations/jobValidation.js';

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
 * Get all course posts (Public)
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

/**
 * Get courses created by current user
 */
export const getMyCourses = catchAsync(
  async (req: CustomRequest, res: Response) => {
    const userId = req.user?.id;
    const userRole = req.user?.role;

    const isAdmin = ['SUPER_ADMIN', 'ADMIN', 'MODERATOR'].includes(
      userRole || '',
    );

    const courses = await prisma.course.findMany({
      where: isAdmin ? { adminId: userId } : { recruiterId: userId },
      orderBy: { createdAt: 'desc' },
    });

    res.status(200).json({
      status: 'success',
      results: courses.length,
      data: { courses },
    });
  },
);

/**
 * Update a course post
 */
export const updateCourse = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const { id } = req.params;
    const validatedData = updateCourseSchema.parse(req.body);
    const userId = req.user?.id;
    const userRole = req.user?.role;

    const isAdmin = ['SUPER_ADMIN', 'ADMIN', 'MODERATOR'].includes(
      userRole || '',
    );

    const course = await prisma.course.findUnique({
      where: { id },
    });

    if (!course) {
      return next(new AppError('Course not found', 404));
    }

    // Ownership check
    if (isAdmin) {
      if (course.adminId !== userId)
        return next(new AppError('Unauthorized', 403));
    } else {
      if (course.recruiterId !== userId)
        return next(new AppError('Unauthorized', 403));
    }

    const updatedCourse = await prisma.course.update({
      where: { id },
      data: validatedData,
    });

    res.status(200).json({
      status: 'success',
      data: { course: updatedCourse },
    });
  },
);

/**
 * Delete a course post
 */
export const deleteCourse = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const { id } = req.params;
    const userId = req.user?.id;
    const userRole = req.user?.role;

    const isAdmin = ['SUPER_ADMIN', 'ADMIN', 'MODERATOR'].includes(
      userRole || '',
    );

    const course = await prisma.course.findUnique({
      where: { id },
    });

    if (!course) {
      return next(new AppError('Course not found', 404));
    }

    // Ownership check
    if (isAdmin) {
      if (course.adminId !== userId)
        return next(new AppError('Unauthorized', 403));
    } else {
      if (course.recruiterId !== userId)
        return next(new AppError('Unauthorized', 403));
    }

    await prisma.course.delete({
      where: { id },
    });

    res.status(204).json({
      status: 'success',
      data: null,
    });
  },
);
