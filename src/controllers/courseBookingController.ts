import { Response, NextFunction } from 'express';
import { prisma } from '../config/prisma.js';
import { catchAsync } from '../utils/catchAsync.js';
import { AppError } from '../utils/AppError.js';
import { stripeService } from '../services/stripeService.js';
import { CustomRequest } from '../types/index.js';
import { Prisma } from '../generated/client/index.js';

const seatHoldingStatuses = ['PENDING', 'CONFIRMED', 'COMPLETED'];

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

    let booking:
      | {
          id: string;
          courseId: string;
          amountPaid: Prisma.Decimal;
          currency: string;
        }
      | undefined;
    let course:
      | {
          title: string;
          price: Prisma.Decimal;
          currency: string;
        }
      | undefined;

    try {
      booking = await prisma.$transaction(async (tx) => {
        const dbCourse = await tx.course.findUnique({
          where: { id: courseId },
          include: {
            sessions: {
              where: { id: { in: normalizedSessionIds } },
              include: {
                bookings: {
                  select: {
                    bookingStatus: true,
                  },
                },
              },
            },
          },
        });

        if (!dbCourse) {
          throw new AppError('Course not found', 404);
        }

        if (dbCourse.status !== 'ACTIVE' && dbCourse.status !== 'FULL') {
          throw new AppError('This course is not open for booking', 400);
        }

        if (dbCourse.sessions.length !== normalizedSessionIds.length) {
          throw new AppError(
            'One or more selected sessions were not found',
            400,
          );
        }

        const existing = await tx.courseBooking.findFirst({
          where: {
            professionalId,
            courseId,
            bookingStatus: { in: ['PENDING', 'CONFIRMED'] },
          },
        });

        if (existing && existing.bookingStatus === 'CONFIRMED') {
          throw new AppError(
            'You already have a confirmed booking for this course',
            400,
          );
        }

        const now = new Date();
        for (const session of dbCourse.sessions) {
          const reservedSeats = session.bookings.filter((candidate) =>
            seatHoldingStatuses.includes(candidate.bookingStatus),
          ).length;
          const derivedAvailableSeats = Math.max(
            0,
            Number(session.totalSeats || 0) - reservedSeats,
          );
          const syncedAvailableSeats = Math.max(
            0,
            Math.min(
              Number(session.availableSeats ?? derivedAvailableSeats),
              derivedAvailableSeats,
            ),
          );

          if (Number(session.availableSeats) !== syncedAvailableSeats) {
            await tx.courseSession.update({
              where: { id: session.id },
              data: { availableSeats: syncedAvailableSeats },
            });
          }

          if (isSessionClosedForEnrollment(session, now)) {
            throw new AppError(
              `Selected session can no longer be booked: ${session.location || session.id}`,
              400,
            );
          }

          if (syncedAvailableSeats <= 0) {
            throw new AppError(
              `Selected session is already full: ${session.location || session.id}`,
              400,
            );
          }
        }

        for (const session of dbCourse.sessions) {
          const reserveResult = await tx.courseSession.updateMany({
            where: {
              id: session.id,
              availableSeats: { gte: 1 },
            },
            data: {
              availableSeats: {
                decrement: 1,
              },
            },
          });

          if (reserveResult.count !== 1) {
            throw new AppError(
              `Selected session is no longer available: ${session.location || session.id}`,
              409,
            );
          }
        }

        course = {
          title: dbCourse.title,
          price: dbCourse.price,
          currency: dbCourse.currency || 'GBP',
        };

        return tx.courseBooking.create({
          data: {
            professionalId,
            courseId,
            amountPaid: Number(dbCourse.price),
            currency: dbCourse.currency || 'GBP',
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
          select: {
            id: true,
            courseId: true,
            amountPaid: true,
            currency: true,
          },
        });
      });
    } catch (error) {
      return next(error);
    }

    // Create Payment Intent
    try {
      const amount = Number(course?.price || booking.amountPaid);
      const currency = course?.currency || booking.currency || 'GBP';
      const paymentIntent = await stripeService.createPaymentIntent({
        amount,
        currency,
        description: `Course booking: ${course?.title || courseId}`,
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
    } catch (error) {
      await prisma.$transaction(async (tx) => {
        await tx.courseBooking.delete({
          where: { id: booking.id },
        });

        await Promise.all(
          normalizedSessionIds.map((id: string) =>
            tx.courseSession.update({
              where: { id },
              data: {
                availableSeats: {
                  increment: 1,
                },
              },
            }),
          ),
        );
      });

      return next(
        error instanceof AppError
          ? error
          : new AppError('Failed to start checkout for this booking', 500),
      );
    }
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

    if (!booking.stripePaymentIntentId) {
      return next(
        new AppError('Payment has not been started for this booking', 400),
      );
    }

    const paymentIntent = await stripeService.retrievePaymentIntent(
      booking.stripePaymentIntentId,
    );

    if (paymentIntent.status !== 'succeeded') {
      return next(new AppError('Payment has not been completed yet', 400));
    }

    const updatedBooking = await prisma.courseBooking.update({
      where: { id: bookingId },
      data: {
        paymentStatus: 'SUCCEEDED',
        bookingStatus:
          booking.bookingStatus === 'PENDING'
            ? 'CONFIRMED'
            : booking.bookingStatus,
        paidAt: booking.paidAt || new Date(),
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
