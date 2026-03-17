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
    const { priceId, sessionIds, documentIds } = req.body;

    if (!professionalId) {
      return next(new AppError('Unauthorized', 401));
    }

    // Get course details
    const course = await prisma.course.findUnique({
      where: { id: courseId },
      include: {
        sessions: true,
        recruiter: {
          select: {
            stripeAccountId: true,
            stripeOnboardingComplete: true,
          },
        },
      },
    });

    if (!course) {
      return next(new AppError('Course not found', 404));
    }

    // Check if session is specified and exists
    // if (sessionId) {
    //     const sessionCount = await prisma.courseSession.count({
    //         where: { id: sessionId, courseId },
    //     });

    //     if (sessionCount === 0) {
    //         return next(new AppError('Course session not found', 404));
    //     }

    //     // Check seats (optional optimization: skip if sessionCount check is sufficient for existence, but seats need full object)
    //     const session = await prisma.courseSession.findUnique({
    //         where: { id: sessionId },
    //     });
    //     if (session && session.availableSeats <= 0) {
    //         return next(new AppError('No seats available for this session', 400));
    //     }
    // } else {
    //     // Enforce Mandatory Session ID as per user request
    //     const hasSessions = await prisma.courseSession.count({
    //         where: { courseId }
    //     });

    //     if (hasSessions > 0) {
    //         return next(new AppError('Session ID is required for this course', 400));
    //     }
    // }

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

    let checkout;

    // Use Split Payment if trainer has Stripe Connect set up
    if (
      course.recruiter?.stripeAccountId &&
      course.recruiter?.stripeOnboardingComplete
    ) {
      checkout = await stripeService.createConnectCheckoutSession({
        courseId,
        professionalId,
        amount: Number(course.price),
        currency: course.currency,
        courseTitle: course.title,
        trainerStripeId: course.recruiter.stripeAccountId,
        // sessionIds,
        // documentIds,
      });
    } else {
      // Standard platform payment
      checkout = await stripeService.createCheckoutSession({
        courseId,
        professionalId,
        amount: Number(course.price),
        currency: course.currency,
        courseTitle: course.title,
        priceId,
        sessionIds,
        documentIds,
      });
    }

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
        sessions: {
          select: {
            id: true,
            startDate: true,
            endDate: true,
            startTime: true,
            endTime: true,
            location: true,
            instructor: true,
          },
        },
        attachedDocuments: true,
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
        sessions: true,
        attachedDocuments: true,
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

/**
 * List all available Stripe prices
 */
export const getStripePrices = catchAsync(
  async (req: CustomRequest, res: Response) => {
    const prices = await stripeService.listActivePrices();

    res.status(200).json({
      status: 'success',
      data: { prices },
    });
  },
);
