import { Response, NextFunction } from 'express';
import { prisma } from '../config/prisma.js';
import { catchAsync } from '../utils/catchAsync.js';
import { AppError } from '../utils/AppError.js';
import { CustomRequest } from '../types/index.js';
import { cancelBookingSchema } from '../validations/jobValidation.js';
import { stripeService } from '../services/stripeService.js';

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
