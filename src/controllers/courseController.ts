import { Response, NextFunction } from 'express';
import { prisma } from '../config/prisma.js';
import { catchAsync } from '../utils/catchAsync.js';
import { AppError } from '../utils/AppError.js';
import { CustomRequest } from '../types/index.js';
import {
  createCourseSchema,
  createCourseDraftSchema,
  updateCourseSchema,
} from '../validations/jobValidation.js';

const adminRoles = ['SUPER_ADMIN', 'ADMIN', 'MODERATOR'];

const userOwnsCourse = (
  course: { adminId: string | null; recruiterId: string | null },
  userId: string | undefined,
  userRole: string | undefined,
) => {
  const isAdmin = adminRoles.includes(userRole || '');
  return isAdmin ? course.adminId === userId : course.recruiterId === userId;
};

export const createCourse = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const validatedData = createCourseSchema.parse(req.body);
    const userId = req.user?.id;
    const userRole = req.user?.role;

    if (!userId || !userRole) {
      return next(new AppError('User context missing', 400));
    }

    const isAdmin = adminRoles.includes(userRole);

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
 * Save a course as a draft.
 */
export const createCourseDraft = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const validatedData = createCourseDraftSchema.parse(req.body);
    const userId = req.user?.id;
    const userRole = req.user?.role;

    if (!userId || !userRole) {
      return next(new AppError('User context missing', 400));
    }

    const isAdmin = adminRoles.includes(userRole);

    const course = await prisma.course.create({
      data: {
        ...validatedData,
        status: 'DRAFT',
        adminId: isAdmin ? userId : null,
        recruiterId: !isAdmin ? userId : null,
      },
    });

    res.status(201).json({
      status: 'success',
      message: 'Course saved as draft',
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
    const where = { status: 'ACTIVE' as const };

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
      },
      orderBy: { createdAt: 'desc' },
    });

    const total = await prisma.course.count({ where });

    res.status(200).json({
      status: 'success',
      results: courses.length,
      total,
      data: { courses },
    });
  },
);

/**
 * Get a single course
 */
export const getCourse = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const { id } = req.params;

    const course = await prisma.course.findUnique({
      where: { id },
      include: {
        recruiter: {
          select: { organizationName: true, email: true },
        },
        admin: {
          select: { email: true },
        },
        sessions: {
          where: {
            startDate: {
              gte: new Date(),
            },
          },
          orderBy: {
            startDate: 'asc',
          },
        },
      },
    });

    if (!course) {
      return next(new AppError('Course not found', 404));
    }

    res.status(200).json({
      status: 'success',
      data: { course },
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

    const isAdmin = adminRoles.includes(userRole || '');

    const courses = await prisma.course.findMany({
      where: isAdmin ? { adminId: userId } : { recruiterId: userId },
      include: {
        sessions: {
          include: {
            bookings: {
              select: {
                id: true,
                bookingStatus: true,
                paymentStatus: true,
                amountPaid: true,
              },
            },
          },
          orderBy: { startDate: 'asc' },
        },
      },
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

    const course = await prisma.course.findUnique({
      where: { id },
    });

    if (!course) {
      return next(new AppError('Course not found', 404));
    }

    // Ownership check
    if (!userOwnsCourse(course, userId, userRole)) {
      return next(new AppError('Unauthorized', 403));
    }

    const updatedCourse = await prisma.course.update({
      where: { id },
      data: {
        ...validatedData,
      },
    });

    res.status(200).json({
      status: 'success',
      data: { course: updatedCourse },
    });
  },
);

/**
 * Publish an owned draft course.
 */
export const publishCourse = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const { id } = req.params;
    const userId = req.user?.id;
    const userRole = req.user?.role;

    const course = await prisma.course.findUnique({
      where: { id },
    });

    if (!course) {
      return next(new AppError('Course not found', 404));
    }

    if (!userOwnsCourse(course, userId, userRole)) {
      return next(new AppError('Unauthorized', 403));
    }

    if (course.status !== 'DRAFT') {
      return next(new AppError('Only draft courses can be published', 400));
    }

    const publishableCourse = createCourseDraftSchema.safeParse({
      title: course.title,
      location: course.location || undefined,
      category: course.category,
      contractType: course.contractType || undefined,
      description: course.description,
      price: Number(course.price),
      trainingType: course.trainingType || undefined,
      issuingAuthority: course.issuingAuthority || undefined,
      duration: course.duration || undefined,
      courseType: course.courseType,
      externalUrl: course.externalUrl || undefined,
      capacity: course.capacity || undefined,
      certificationProvided: course.certificationProvided || undefined,
      curriculum: course.curriculum || undefined,
      requirements: course.requirements || undefined,
    });

    if (!publishableCourse.success) {
      return next(
        new AppError(
          `Course cannot be published: ${publishableCourse.error.issues[0].message}`,
          400,
        ),
      );
    }

    const updatedCourse = await prisma.course.update({
      where: { id },
      data: { status: 'ACTIVE' },
    });

    res.status(200).json({
      status: 'success',
      message: 'Course published successfully',
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

    const course = await prisma.course.findUnique({
      where: { id },
    });

    if (!course) {
      return next(new AppError('Course not found', 404));
    }

    // Ownership check
    if (!userOwnsCourse(course, userId, userRole)) {
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
