import { Response, NextFunction } from 'express';
import { prisma } from '../config/prisma.js';
import { catchAsync } from '../utils/catchAsync.js';
import { AppError } from '../utils/AppError.js';
import { CustomRequest } from '../types/index.js';
import { cancelBookingSchema } from '../validations/jobValidation.js';
import { stripeService } from '../services/stripeService.js';
import {
  notifyCourseBookingCancelled,
  safeNotify,
} from '../services/eventNotificationService.js';

const sessionBookingConsumesSeat = (bookingStatus?: string | null) =>
  ['PENDING', 'CONFIRMED', 'COMPLETED'].includes(String(bookingStatus || ''));

const isSessionClosedForEnrollment = (
  session: {
    endDate: Date | string;
    enrollmentDeadline?: Date | string | null;
  },
  now: Date,
) => {
  const endsAt = new Date(session.endDate);
  const deadline = session.enrollmentDeadline
    ? new Date(session.enrollmentDeadline)
    : null;

  return (
    endsAt.getTime() < now.getTime() ||
    Boolean(deadline && deadline.getTime() < now.getTime())
  );
};

/**
 * Get all courses for professionals with advanced filtering
 */
export const getCourses = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const professionalId = req.user?.id;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    if (!professionalId) {
      return next(new AppError('Unauthorized', 401));
    }

    const { search, category, priceRange, duration } = req.query;

    const where: any = { status: 'ACTIVE' }; // eslint-disable-line @typescript-eslint/no-explicit-any

    where.bookings = {
      none: {
        professionalId,
        bookingStatus: { in: ['PENDING', 'CONFIRMED', 'COMPLETED'] },
      },
    };

    if (search) {
      where.OR = [
        { title: { contains: search as string, mode: 'insensitive' } },
        { description: { contains: search as string, mode: 'insensitive' } },
      ];
    }

    if (category) where.category = category;

    if (priceRange) {
      const [min, max] = (priceRange as string).split('-').map(Number);
      where.price = {
        gte: min || 0,
        lte: max || 999999,
      };
    }

    if (duration) {
      where.duration = { contains: duration as string, mode: 'insensitive' };
    }

    const rawCourses = await prisma.course.findMany({
      where,
      include: {
        recruiter: {
          select: { organizationName: true },
        },
        sessions: {
          include: {
            bookings: {
              select: {
                bookingStatus: true,
              },
            },
          },
          orderBy: { startDate: 'asc' },
        },
        savedBy: professionalId
          ? {
              where: { professionalId },
              select: { id: true },
            }
          : false,
      },
      orderBy: { createdAt: 'desc' },
    });

    const now = new Date();
    const courses = rawCourses.filter((course) =>
      course.sessions.some((session) => {
        const reservedSeats = session.bookings.filter((booking) =>
          sessionBookingConsumesSeat(booking.bookingStatus),
        ).length;
        const availableSeats = Math.max(
          0,
          Math.min(
            Number(session.availableSeats || session.totalSeats || 0),
            Number(session.totalSeats || 0) - reservedSeats,
          ),
        );

        return (
          !isSessionClosedForEnrollment(session, now) && availableSeats > 0
        );
      }),
    );

    const total = courses.length;
    const pagedCourses = courses.slice(skip, skip + limit);

    const formattedCourses = pagedCourses.map((course) => {
      const { savedBy, recruiter, ...rest } = course;
      return {
        ...rest,
        providerName: recruiter?.organizationName || 'Maritime Academy',
        isSaved: (savedBy && savedBy.length > 0) || false,
      };
    });

    res.status(200).json({
      status: 'success',
      results: formattedCourses.length,
      total,
      data: { courses: formattedCourses },
    });
  },
);

/**
 * Get sessions for a specific course with seat info
 */
export const getCourseSessions = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const { courseId } = req.params;
    const now = new Date();

    const course = await prisma.course.findUnique({
      where: { id: courseId },
      include: {
        sessions: {
          include: {
            bookings: {
              select: {
                id: true,
                bookingStatus: true,
              },
            },
          },
          orderBy: { startDate: 'asc' },
        },
      },
    });

    if (!course) {
      return next(new AppError('Course not found', 404));
    }

    const sessions = course.sessions.map((s) => {
      const reservedSeats = s.bookings.filter((booking) =>
        sessionBookingConsumesSeat(booking.bookingStatus),
      ).length;
      const availableSeats = Math.max(
        0,
        Math.min(
          Number(s.availableSeats || s.totalSeats || 0),
          Number(s.totalSeats || 0) - reservedSeats,
        ),
      );
      const isClosed = isSessionClosedForEnrollment(s, now);
      const status = isClosed
        ? 'EXPIRED'
        : availableSeats > 0
          ? 'AVAILABLE'
          : 'FULL';

      return {
        id: s.id,
        eventDate: s.startDate,
        startDate: s.startDate,
        endDate: s.endDate,
        startTime: s.startTime,
        endTime: s.endTime,
        totalSeats: s.totalSeats,
        bookedSeats: reservedSeats,
        availableSeats,
        location: s.location,
        status,
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
 * Cancel a course booking
 */
export const cancelBooking = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const professionalId = req.user?.id;
    const { bookingId } = req.params;
    cancelBookingSchema.parse(req.body);

    if (!professionalId) {
      return next(new AppError('Unauthorized', 401));
    }

    // Find booking
    const booking = await prisma.courseBooking.findFirst({
      where: {
        id: bookingId,
        professionalId,
      },
      include: {
        sessions: true,
        course: true,
      },
    });

    if (!booking) {
      return next(new AppError('Booking not found', 404));
    }

    // Check if booking can be cancelled
    if (booking.bookingStatus === 'CANCELLED') {
      return next(new AppError('Booking is already cancelled', 400));
    }

    if (booking.bookingStatus === 'COMPLETED') {
      return next(new AppError('Cannot cancel completed booking', 400));
    }

    // Check if any course session has already started
    if (booking.sessions && booking.sessions.length > 0) {
      const earliestSession = [...booking.sessions].sort(
        (a, b) =>
          new Date(a.startDate).getTime() - new Date(b.startDate).getTime(),
      )[0];
      const sessionStartDate = new Date(earliestSession.startDate);
      if (sessionStartDate < new Date()) {
        return next(
          new AppError('Cannot cancel booking after course has started', 400),
        );
      }
    }

    // Process refund if payment was successful
    let refundProcessed = false;
    if (
      booking.paymentStatus === 'SUCCEEDED' &&
      booking.stripePaymentIntentId
    ) {
      try {
        await stripeService.refundPayment(booking.stripePaymentIntentId);
        refundProcessed = true;
      } catch (error) {
        console.error('Refund failed:', error);
        // Continue with cancellation even if refund fails
      }
    }

    // Update booking status
    const updatedBooking = await prisma.courseBooking.update({
      where: { id: bookingId },
      data: {
        bookingStatus: 'CANCELLED',
        paymentStatus: refundProcessed ? 'REFUNDED' : booking.paymentStatus,
      },
    });

    if (booking.sessions && booking.sessions.length > 0) {
      await Promise.all(
        booking.sessions.map((session) =>
          prisma.courseSession.update({
            where: { id: session.id },
            data: {
              availableSeats: {
                increment: 1,
              },
            },
          }),
        ),
      );
    }

    safeNotify('course-booking-cancelled', () =>
      notifyCourseBookingCancelled({ bookingId, cancelledBy: 'PROFESSIONAL' }),
    );

    // Decrement enrolled count
    if (booking.course) {
      await prisma.course.update({
        where: { id: booking.courseId },
        data: {
          enrolledCount: {
            decrement: 1,
          },
        },
      });
    }

    res.status(200).json({
      status: 'success',
      data: {
        booking: updatedBooking,
        refundProcessed,
      },
    });
  },
);

/**
 * Get recommended courses based on expired/expiring certificates
 */
export const getRecommendedCourses = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const professionalId = req.user?.id;

    if (!professionalId) {
      return next(new AppError('Unauthorized', 401));
    }

    // Get professional's documents
    const documents = await prisma.professionalDocument.findMany({
      where: { professionalId },
      select: {
        category: true,
        expiryDate: true,
      },
    });

    // Find expired or expiring documents (within 60 days)
    const now = new Date();
    const sixtyDaysFromNow = new Date();
    sixtyDaysFromNow.setDate(now.getDate() + 60);

    const expiringCategories = documents
      .filter((doc) => {
        if (!doc.expiryDate) return false;
        const expiryDate = new Date(doc.expiryDate);
        return expiryDate <= sixtyDaysFromNow;
      })
      .map((doc) => doc.category);

    // Get recommended courses matching these categories
    const recommendedCourses = await prisma.course.findMany({
      where: {
        status: 'ACTIVE',
        courseType: 'INTERNAL',
        category: {
          in: expiringCategories,
        },
      },
      include: {
        recruiter: {
          select: {
            organizationName: true,
            email: true,
          },
        },
        sessions: {
          where: {
            startDate: {
              gte: now,
            },
          },
          orderBy: {
            startDate: 'asc',
          },
          take: 3,
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 10,
    });

    res.status(200).json({
      status: 'success',
      results: recommendedCourses.length,
      data: {
        courses: recommendedCourses,
        expiringCategories,
      },
    });
  },
);

/**
 * Toggle Save/Unsave a course
 */
export const toggleSaveCourse = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const professionalId = req.user?.id;
    const { id: courseId } = req.params;

    if (!professionalId) return next(new AppError('Unauthorized', 401));

    const existing = await prisma.savedCourse.findUnique({
      where: {
        professionalId_courseId: {
          professionalId,
          courseId,
        },
      },
    });

    if (existing) {
      await prisma.savedCourse.delete({
        where: { id: existing.id },
      });
      return res.status(200).json({
        status: 'success',
        message: 'Course removed from saved list',
        data: { saved: false },
      });
    }

    await prisma.savedCourse.create({
      data: {
        professionalId,
        courseId,
      },
    });

    res.status(200).json({
      status: 'success',
      message: 'Course saved successfully',
      data: { saved: true },
    });
  },
);

/**
 * Get all saved courses for the current professional
 */
export const getSavedCourses = catchAsync(
  async (req: CustomRequest, res: Response) => {
    const professionalId = req.user?.id;

    const savedCourses = await prisma.savedCourse.findMany({
      where: { professionalId },
      include: {
        course: {
          include: {
            recruiter: { select: { organizationName: true } },
            sessions: {
              where: { startDate: { gte: new Date() } },
              take: 1,
            },
            admin: { select: { email: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.status(200).json({
      status: 'success',
      results: savedCourses.length,
      data: {
        courses: savedCourses.map((sc) => sc.course),
      },
    });
  },
);
