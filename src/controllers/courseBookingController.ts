import { Response, NextFunction } from 'express';
import { prisma } from '../config/prisma.js';
import { catchAsync } from '../utils/catchAsync.js';
import { AppError } from '../utils/AppError.js';
import { stripeService } from '../services/stripeService.js';
import { CustomRequest } from '../types/index.js';

/**
 * Create a checkout session for a course booking
 */
export const createCheckoutSession = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const professionalId = req.user?.id;
    const { courseId } = req.params;
    const { sessionId } = req.body; // Optional: specific course session

    if (!professionalId) {
      return next(new AppError('Unauthorized', 401));
    }

    // Get course details
    const course = await prisma.course.findUnique({
      where: { id: courseId },
      include: { sessions: true },
    });

    if (!course) {
      return next(new AppError('Course not found', 404));
    }

    // Check if session is specified and exists
    if (sessionId) {
      const session = await prisma.courseSession.findUnique({
        where: { id: sessionId },
      });

      if (!session || session.courseId !== courseId) {
        return next(new AppError('Course session not found', 404));
      }

      // Check if seats are available
      if (session.availableSeats <= 0) {
        return next(new AppError('No seats available for this session', 400));
      }
    }

    // Check if user already has a pending or confirmed booking
    const existingBooking = await prisma.courseBooking.findFirst({
      where: {
        professionalId,
        courseId,
        bookingStatus: { in: ['PENDING', 'CONFIRMED'] },
      },
    });

    if (existingBooking) {
      return next(
        new AppError('You already have a booking for this course', 400),
      );
    }

    // Create Stripe checkout session
    const checkout = await stripeService.createCheckoutSession({
      courseId,
      professionalId,
      amount: Number(course.price),
      currency: course.currency,
      courseTitle: course.title,
      sessionId,
    });

    res.status(200).json({
      status: 'success',
      data: {
        checkoutUrl: checkout.checkoutUrl,
        bookingId: checkout.bookingId,
      },
    });
  },
);

/**
 * Get all bookings for the current professional
 */
export const getMyBookings = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const professionalId = req.user?.id;

    if (!professionalId) {
      return next(new AppError('Unauthorized', 401));
    }

    const bookings = await prisma.courseBooking.findMany({
      where: { professionalId },
      include: {
        course: {
          select: {
            id: true,
            title: true,
            location: true,
            category: true,
            description: true,
          },
        },
        session: {
          select: {
            startDate: true,
            endDate: true,
            startTime: true,
            endTime: true,
            location: true,
            instructor: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.status(200).json({
      status: 'success',
      data: { bookings },
    });
  },
);

/**
 * Get a specific booking by ID
 */
export const getBookingById = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const professionalId = req.user?.id;
    const { bookingId } = req.params;

    if (!professionalId) {
      return next(new AppError('Unauthorized', 401));
    }

    const booking = await prisma.courseBooking.findFirst({
      where: {
        id: bookingId,
        professionalId,
      },
      include: {
        course: true,
        session: true,
      },
    });

    if (!booking) {
      return next(new AppError('Booking not found', 404));
    }

    res.status(200).json({
      status: 'success',
      data: { booking },
    });
  },
);

/**
 * Handle Stripe webhook events
 */
export const handleStripeWebhook = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const signature = req.headers['stripe-signature'] as string;

    if (!signature) {
      return next(new AppError('Missing stripe signature', 400));
    }

    // Raw body is required for webhook signature verification
    const rawBody = req.body as Buffer;

    await stripeService.handleWebhook(signature, rawBody);

    res.status(200).json({ received: true });
  },
);
