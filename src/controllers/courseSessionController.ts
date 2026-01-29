import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/prisma.js';
import { catchAsync } from '../utils/catchAsync.js';
import { AppError } from '../utils/AppError.js';
import {
  createSessionSchema,
  updateSessionSchema,
} from '../validations/courseSessionValidation.js';

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

    const sessions = await prisma.courseSession.findMany({
      where: { courseId },
      orderBy: { startDate: 'asc' },
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

    await prisma.courseSession.delete({ where: { id } });

    res.status(204).json({
      status: 'success',
      data: null,
    });
  },
);
