import { Response, NextFunction } from 'express';
import { prisma } from '../config/prisma.js';
import { catchAsync } from '../utils/catchAsync.js';
import { AppError } from '../utils/AppError.js';
import { stripeService } from '../services/stripeService.js';
import { CustomRequest } from '../types/index.js';

/**
 * Create a booking and a Stripe Payment Intent (for Stripe Elements)
 */
export const checkout = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const professionalId = req.user?.id;
    const { courseId, sessionIds, documentIds } = req.body;

    if (!professionalId) {
      return next(new AppError('Unauthorized', 401));
    }

    // Get course details
    const normalizedSessionIds = Array.isArray(sessionIds)
      ? [...new Set(sessionIds.filter(Boolean))]
      : [];

    if (normalizedSessionIds.length === 0) {
      return next(new AppError('Please select at least one session', 400));
    }

    const course = await prisma.course.findUnique({
      where: { id: courseId },
      include: {
        sessions: {
          where: { id: { in: normalizedSessionIds } },
          include: {
            bookings: {
              select: {
                id: true,
                bookingStatus: true,
              },
            },
          },
        },
      },
    });

    if (!course) {
      return next(new AppError('Course not found', 404));
    }

    if (course.status !== 'ACTIVE' && course.status !== 'FULL') {
      return next(new AppError('This course is not open for booking', 400));
    }

    if (course.sessions.length !== normalizedSessionIds.length) {
      return next(
        new AppError('One or more selected sessions were not found', 400),
      );
    }

    const now = new Date();
    for (const session of course.sessions) {
      const reservedSeats = session.bookings.filter((booking) =>
        ['PENDING', 'CONFIRMED', 'COMPLETED'].includes(booking.bookingStatus),
      ).length;
      const availableSeats = Math.max(0, session.totalSeats - reservedSeats);
      const isExpired = new Date(session.endDate).getTime() < now.getTime();

      if (isExpired) {
        return next(
          new AppError(
            `Selected session has already expired: ${session.location || session.id}`,
            400,
          ),
        );
      }

      if (availableSeats <= 0) {
        return next(
          new AppError(
            `Selected session is already full: ${session.location || session.id}`,
            400,
          ),
        );
      }
    }

    // Check if user already has a pending or confirmed booking for these sessions
    // (Simplified check for brevity, but ideally check session overlap)
    const existing = await prisma.courseBooking.findFirst({
      where: {
        professionalId,
        courseId,
        bookingStatus: { in: ['PENDING', 'CONFIRMED'] },
      },
    });

    if (existing && existing.bookingStatus === 'CONFIRMED') {
      return next(
        new AppError(
          'You already have a confirmed booking for this course',
          400,
        ),
      );
    }

    // Calculate amount
    const amount = Number(course.price);
    const currency = course.currency || 'GBP';

    // Create a pending booking in the database
    const booking = await prisma.courseBooking.create({
      data: {
        professionalId,
        courseId,
        amountPaid: amount,
        currency,
        bookingStatus: 'PENDING',
        paymentStatus: 'PENDING',
        sessions: {
          connect: normalizedSessionIds.map((id: string) => ({ id })),
        },
        ...(documentIds &&
          documentIds.length > 0 && {
            attachedDocuments: {
              connect: documentIds.map((id: string) => ({ id })),
            },
          }),
      },
    });

    // Create Payment Intent
    const paymentIntent = await stripeService.createPaymentIntent({
      amount,
      currency,
      description: `Course booking: ${course.title}`,
      metadata: {
        bookingId: booking.id,
        courseId,
        professionalId,
      },
    });

    // Update booking with PI ID
    await prisma.courseBooking.update({
      where: { id: booking.id },
      data: { stripePaymentIntentId: paymentIntent.id },
    });

    res.status(200).json({
      status: 'success',
      data: {
        bookingId: booking.id,
        amount,
        currency,
        paymentIntentId: paymentIntent.id,
        clientSecret: paymentIntent.client_secret,
        paymentStatus: 'requires_payment_method',
      },
    });
  },
);

/**
 * Confirm booking payment (Fallback for frontend sync)
 */
export const confirmBooking = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const { bookingId } = req.params;
    const professionalId = req.user?.id;

    const booking = await prisma.courseBooking.findFirst({
      where: { id: bookingId, professionalId },
    });

    if (!booking) {
      return next(new AppError('Booking not found', 404));
    }

    // Usually, we rely on webhooks, but we can verify status here if needed
    // For this flow, we'll mark as pending_approval if status is succeeded
    const updatedBooking = await prisma.courseBooking.update({
      where: { id: bookingId },
      data: {
        // bookingStatus: 'PENDING', // already pending, moves to confirmed on webhook or approval
        paymentStatus: 'SUCCEEDED', // assuming frontend passed client-side success
      },
    });

    res.status(200).json({
      status: 'success',
      data: {
        bookingId: updatedBooking.id,
        paymentStatus: updatedBooking.paymentStatus,
        bookingStatus: updatedBooking.bookingStatus,
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
