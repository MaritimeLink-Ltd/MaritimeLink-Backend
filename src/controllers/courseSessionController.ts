import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { canViewFinancials } from '../config/adminRoles.js';
import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/prisma.js';
import { catchAsync } from '../utils/catchAsync.js';
import { AppError } from '../utils/AppError.js';
import {
  createSessionSchema,
  updateSessionSchema,
} from '../validations/courseSessionValidation.js';
import { CustomRequest } from '../types/index.js';
import { canManageCourse } from './courseController.js';

/**
 * Sessions can only be changed by whoever can manage the parent course (its
 * owning trainer, or a platform admin for MaritimeLink-listed courses) — the
 * same rule course edits already follow.
 */
const userCanManageCourse = async (
  req: Request,
  courseId: string,
): Promise<boolean> => {
  const user = (req as CustomRequest).user;
  if (!user?.id) return false;
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: { adminId: true, recruiterId: true },
  });
  if (!course) return false;
  return canManageCourse(course, user.id, user.role);
};

/**
 * True when the (optional) session token belongs to the course's owner or to
 * a platform admin whose role may see money.
 */
const viewerMaySeeCourseRevenue = async (
  req: Request,
  courseId: string,
): Promise<boolean> => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return false;
  let viewerId: string | undefined;
  try {
    const decoded = jwt.verify(header.slice(7).trim(), env.JWT_SECRET, {
      algorithms: ['HS256'],
    }) as { id?: unknown };
    viewerId = typeof decoded?.id === 'string' ? decoded.id : undefined;
  } catch {
    return false;
  }
  if (!viewerId) return false;

  const admin = await prisma.admin.findUnique({
    where: { id: viewerId },
    select: { role: true, disabledAt: true },
  });
  if (admin) return !admin.disabledAt && canViewFinancials(admin.role);

  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: { recruiterId: true },
  });
  return !!course?.recruiterId && course.recruiterId === viewerId;
};

/**
 * Create a new session for a course
 */
export const createSession = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const { courseId } = req.params;

    const validation = createSessionSchema.safeParse(req.body);
    if (!validation.success) {
      return next(new AppError(validation.error.issues[0].message, 400));
    }

    const course = await prisma.course.findUnique({ where: { id: courseId } });
    if (!course) {
      return next(new AppError('Course not found', 404));
    }

    if (!(await userCanManageCourse(req, courseId))) {
      return next(new AppError('Unauthorized', 403));
    }

    const session = await prisma.courseSession.create({
      data: {
        ...validation.data,
        startDate: new Date(validation.data.startDate),
        endDate: new Date(validation.data.endDate),
        availableSeats: validation.data.totalSeats,
        courseId,
      },
    });

    res.status(201).json({
      status: 'success',
      data: { session },
    });
  },
);

/**
 * Get all sessions for a specific course
 */
export const getCourseSessions = catchAsync(
  async (req: Request, res: Response) => {
    const { courseId } = req.params;

    const rawSessions = await prisma.courseSession.findMany({
      where: { courseId },
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
    });
    // This list is public (booking pages use it), but takings per session are
    // only for the course's owner and for admins allowed to see money.
    const showRevenue = await viewerMaySeeCourseRevenue(req, courseId);

    const sessions = rawSessions.map(({ bookings, ...session }) => {
      const activeBookings = bookings.filter((booking) =>
        ['CONFIRMED', 'COMPLETED'].includes(booking.bookingStatus),
      );
      const pendingBookings = bookings.filter(
        (booking) => booking.bookingStatus === 'PENDING',
      );
      const paidBookings = bookings.filter(
        (booking) => booking.paymentStatus === 'SUCCEEDED',
      );

      return {
        ...session,
        bookedCount: activeBookings.length,
        pendingBookings: pendingBookings.length,
        ...(showRevenue && {
          revenue: paidBookings.reduce(
            (sum, booking) => sum + Number(booking.amountPaid),
            0,
          ),
        }),
      };
    });

    res.status(200).json({
      status: 'success',
      results: sessions.length,
      data: { sessions },
    });
  },
);

/**
 * Get a single session by ID
 */
export const getSession = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;

    const session = await prisma.courseSession.findUnique({
      where: { id },
      include: { course: true },
    });

    if (!session) {
      return next(new AppError('Session not found', 404));
    }

    res.status(200).json({
      status: 'success',
      data: { session },
    });
  },
);

/**
 * Update a session
 */
export const updateSession = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;

    const validation = updateSessionSchema.safeParse(req.body);
    if (!validation.success) {
      return next(new AppError(validation.error.issues[0].message, 400));
    }

    const existingSession = await prisma.courseSession.findUnique({
      where: { id },
    });
    if (!existingSession) {
      return next(new AppError('Session not found', 404));
    }

    if (!(await userCanManageCourse(req, existingSession.courseId))) {
      return next(new AppError('Unauthorized', 403));
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateData: Record<string, any> = { ...validation.data };
    if (validation.data.startDate)
      updateData.startDate = new Date(validation.data.startDate);
    if (validation.data.endDate)
      updateData.endDate = new Date(validation.data.endDate);

    // If totalSeats is updated, adjust availableSeats accordingly
    if (validation.data.totalSeats !== undefined) {
      const seatsDifference =
        validation.data.totalSeats - existingSession.totalSeats;
      updateData.availableSeats =
        existingSession.availableSeats + seatsDifference;

      if (updateData.availableSeats < 0) {
        return next(
          new AppError('Cannot reduce total seats below current bookings', 400),
        );
      }
    }

    const updatedSession = await prisma.courseSession.update({
      where: { id },
      data: updateData,
    });

    res.status(200).json({
      status: 'success',
      data: { session: updatedSession },
    });
  },
);

/**
 * Delete a session
 */
export const deleteSession = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;

    const session = await prisma.courseSession.findUnique({ where: { id } });
    if (!session) {
      return next(new AppError('Session not found', 404));
    }

    if (!(await userCanManageCourse(req, session.courseId))) {
      return next(new AppError('Unauthorized', 403));
    }

    await prisma.courseSession.delete({ where: { id } });

    res.status(204).json({
      status: 'success',
      data: null,
    });
  },
);
