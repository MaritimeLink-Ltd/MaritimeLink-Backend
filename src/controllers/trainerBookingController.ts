import { Response, NextFunction } from 'express';
import { prisma } from '../config/prisma.js';
import { catchAsync } from '../utils/catchAsync.js';
import { AppError } from '../utils/AppError.js';
import { CustomRequest } from '../types/index.js';
import {
  updateBookingStatusSchema,
  messageTraineeSchema,
} from '../validations/jobValidation.js';
import {
  stripeService,
  isBookingPaymentSucceeded,
} from '../services/stripeService.js';
import {
  notifyCourseBookingCancelled,
  safeNotify,
} from '../services/eventNotificationService.js';

const bookingDocumentSelect = {
  id: true,
  category: true,
  name: true,
  number: true,
  issuingCountry: true,
  issueDate: true,
  expiryDate: true,
  fileUrl: true,
  mimeType: true,
  ocrStatus: true,
  verificationStatus: true,
  createdAt: true,
} as const;

const bookedProfessionalSelect = {
  id: true,
  fullname: true,
  firstName: true,
  middleName: true,
  lastName: true,
  email: true,
  profession: true,
  subcategory: true,
  profilePhotoUrl: true,
  resume: {
    include: {
      education: true,
      licenses: true,
      medicalCertificates: true,
      stcwCertificates: true,
      travelDocuments: true,
      skills: true,
      seaService: true,
      nextOfKin: true,
      referees: true,
    },
  },
} as const;

/**
 * Get all bookings for a specific course
 */
export const getCourseBookings = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const { courseId } = req.params;
    const userId = req.user?.id;
    const userRole = req.user?.role;

    // Verify ownership
    const course = await prisma.course.findUnique({
      where: { id: courseId },
    });

    if (!course) {
      return next(new AppError('Course not found', 404));
    }

    // Check if user owns this course
    const isAdmin = ['SUPER_ADMIN', 'ADMIN', 'MODERATOR'].includes(
      userRole || '',
    );
    if (!isAdmin && course.recruiterId !== userId) {
      return next(new AppError('Unauthorized', 403));
    }

    const bookings = await prisma.courseBooking.findMany({
      where: { courseId },
      include: {
        professional: {
          select: bookedProfessionalSelect,
        },
        attachedDocuments: {
          select: bookingDocumentSelect,
        },
        sessions: {
          select: {
            id: true,
            startDate: true,
            endDate: true,
            startTime: true,
            endTime: true,
            location: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.status(200).json({
      status: 'success',
      results: bookings.length,
      data: { bookings },
    });
  },
);

/**
 * Get all bookings across all trainer's courses
 */
export const getAllTrainerBookings = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const recruiterId = req.user?.id;

    if (!recruiterId) {
      return next(new AppError('Unauthorized', 401));
    }

    const bookings = await prisma.courseBooking.findMany({
      where: {
        course: {
          recruiterId,
        },
      },
      include: {
        course: {
          select: {
            id: true,
            title: true,
            category: true,
            location: true,
            capacity: true,
          },
        },
        professional: {
          select: bookedProfessionalSelect,
        },
        attachedDocuments: {
          select: bookingDocumentSelect,
        },
        sessions: {
          select: {
            id: true,
            startDate: true,
            endDate: true,
            startTime: true,
            endTime: true,
            location: true,
            totalSeats: true,
            availableSeats: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.status(200).json({
      status: 'success',
      results: bookings.length,
      data: { bookings },
    });
  },
);

/**
 * Get specific booking details
 */
export const getTrainerBookingById = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const { bookingId } = req.params;
    const recruiterId = req.user?.id;

    if (!recruiterId) {
      return next(new AppError('Unauthorized', 401));
    }

    const booking = await prisma.courseBooking.findFirst({
      where: {
        id: bookingId,
        course: {
          recruiterId,
        },
      },
      include: {
        course: true,
        professional: {
          select: bookedProfessionalSelect,
        },
        attachedDocuments: {
          select: bookingDocumentSelect,
        },
        sessions: true,
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
 * Get a booked professional profile for trainer attendee review.
 */
export const getTrainerProfessionalById = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const { professionalId } = req.params;
    const recruiterId = req.user?.id;

    if (!recruiterId) {
      return next(new AppError('Unauthorized', 401));
    }

    const professional = await prisma.professional.findFirst({
      where: {
        id: professionalId,
        bookings: {
          some: {
            course: {
              recruiterId,
            },
          },
        },
      },
      include: {
        kyc: true,
        bookings: {
          where: {
            course: {
              recruiterId,
            },
          },
          include: {
            course: true,
            sessions: true,
            attachedDocuments: {
              select: bookingDocumentSelect,
            },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!professional) {
      return next(new AppError('Professional not found', 404));
    }

    res.status(200).json({
      status: 'success',
      data: { professional },
    });
  },
);

/**
 * Update booking status
 */
export const updateBookingStatus = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const { bookingId } = req.params;
    const recruiterId = req.user?.id;
    const validatedData = updateBookingStatusSchema.parse(req.body);

    if (!recruiterId) {
      return next(new AppError('Unauthorized', 401));
    }

    // Verify ownership
    const booking = await prisma.courseBooking.findFirst({
      where: {
        id: bookingId,
        course: {
          recruiterId,
        },
      },
    });

    if (!booking) {
      return next(new AppError('Booking not found', 404));
    }

    const newStatus = validatedData.status;

    const updatedBooking = await prisma.courseBooking.update({
      where: { id: bookingId },
      data: {
        bookingStatus: newStatus,
      },
      include: {
        course: {
          include: {
            recruiter: {
              select: { stripeAccountId: true, stripeOnboardingComplete: true },
            },
          },
        },
      },
    });

    res.status(200).json({
      status: 'success',
      data: { booking: updatedBooking },
    });
  },
);

/**
 * Get attendees for a specific session
 */
export const getSessionAttendees = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const { sessionId } = req.params;
    const recruiterId = req.user?.id;

    if (!recruiterId) return next(new AppError('Unauthorized', 401));

    const session = await prisma.courseSession.findFirst({
      where: {
        id: sessionId,
        course: { recruiterId },
      },
      include: {
        bookings: {
          include: {
            attachedDocuments: {
              select: bookingDocumentSelect,
            },
            professional: {
              select: bookedProfessionalSelect,
            },
          },
        },
      },
    });

    if (!session) return next(new AppError('Session not found', 404));

    const attendees = session.bookings.map((b) => {
      return {
        bookingId: b.id,
        professionalId: b.professional.id,
        fullname:
          b.professional.fullname ||
          [
            b.professional.firstName,
            b.professional.middleName,
            b.professional.lastName,
          ]
            .filter(Boolean)
            .join(' '),
        email: b.professional.email,
        photo: b.professional.profilePhotoUrl,
        profession: b.professional.profession,
        subcategory: b.professional.subcategory,
        status: b.bookingStatus,
        paymentStatus: b.paymentStatus,
        attachedDocuments: b.attachedDocuments,
      };
    });

    res.status(200).json({
      status: 'success',
      results: attendees.length,
      data: { attendees },
    });
  },
);

/**
 * Approve a specific attendee (Triggers Payout)
 */
export const approveAttendee = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const { bookingId } = req.params;
    const recruiterId = req.user?.id;

    if (!recruiterId) return next(new AppError('Unauthorized', 401));

    const booking = await prisma.courseBooking.findFirst({
      where: {
        id: bookingId,
        course: { recruiterId },
      },
      include: {
        course: {
          select: {
            title: true,
            recruiter: {
              select: { stripeAccountId: true, stripeOnboardingComplete: true },
            },
          },
        },
      },
    });

    if (!booking) return next(new AppError('Booking not found', 404));

    // Approval can only happen if booking is CONFIRMED (paid) or PENDING
    if (booking.bookingStatus === 'COMPLETED') {
      return next(
        new AppError('Attendee already approved and payout processed', 400),
      );
    }

    const platformFee = Number(booking.amountPaid) * 0.18;
    const trainerPayout = Number(booking.amountPaid) * 0.82;

    if (booking.paymentStatus === 'SUCCEEDED') {
      const trainer = booking.course.recruiter;
      if (!trainer?.stripeAccountId || !trainer?.stripeOnboardingComplete) {
        return next(
          new AppError(
            'Trainer Stripe onboarding is not complete. Connect Stripe before releasing payout.',
            400,
          ),
        );
      }

      await stripeService.createTransfer({
        amount: trainerPayout,
        currency: booking.currency,
        destinationAccountId: trainer.stripeAccountId,
        bookingId: booking.id,
      });
    }

    // Update status to COMPLETED only after payout succeeds or if no payment is due.
    const updatedBooking = await prisma.courseBooking.update({
      where: { id: bookingId },
      data: {
        bookingStatus: 'COMPLETED',
        platformFee:
          booking.paymentStatus === 'SUCCEEDED'
            ? platformFee
            : booking.platformFee,
        trainerPayout:
          booking.paymentStatus === 'SUCCEEDED'
            ? trainerPayout
            : booking.trainerPayout,
      },
    });

    const approvalAlert = await prisma.alert.create({
      data: {
        professionalId: booking.professionalId,
        type: 'COURSE_BOOKING_STATUS',
        title: 'Course Booking Approved',
        message:
          booking.paymentStatus === 'SUCCEEDED'
            ? `Your booking for "${booking.course.title}" was approved and completed.`
            : `Your booking for "${booking.course.title}" was approved.`,
        metadata: {
          bookingId: booking.id,
          courseTitle: booking.course.title,
          status: 'COMPLETED',
          payoutReleased: booking.paymentStatus === 'SUCCEEDED',
        },
      },
    });

    const io = req.app.get('io');
    if (io) {
      io.to(booking.professionalId).emit('professional_alert', {
        alert: approvalAlert,
      });
    }

    res.status(200).json({
      status: 'success',
      message:
        booking.paymentStatus === 'SUCCEEDED'
          ? 'Attendee approved successfully. Payout released.'
          : 'Attendee approved successfully.',
      data: { booking: updatedBooking },
    });
  },
);

/**
 * Reject a specific attendee by cancelling their booking.
 */
export const rejectAttendee = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const { bookingId, sessionId } = req.params;
    const recruiterId = req.user?.id;

    if (!recruiterId) return next(new AppError('Unauthorized', 401));

    const booking = await prisma.courseBooking.findFirst({
      where: {
        id: bookingId,
        course: { recruiterId },
        ...(sessionId ? { sessions: { some: { id: sessionId } } } : {}),
      },
    });

    if (!booking) return next(new AppError('Booking not found', 404));

    if (booking.bookingStatus === 'COMPLETED') {
      return next(new AppError('Completed attendees cannot be rejected', 400));
    }

    if (booking.bookingStatus === 'CANCELLED') {
      return next(new AppError('This booking is already cancelled', 400));
    }

    if (booking.paymentStatus === 'REFUNDED') {
      return next(new AppError('This booking has already been refunded', 400));
    }

    let refundProcessed = false;
    let resolvedPaymentIntentId: string | null = null;
    let stripeRefundId: string | null = null;
    let refundAmount: number | null = null;
    let refundCurrency: string | null = null;
    let refundNote: string | null = null;

    if (isBookingPaymentSucceeded(booking.paymentStatus)) {
      resolvedPaymentIntentId =
        await stripeService.resolvePaymentIntentIdForBooking({
          id: booking.id,
          stripePaymentIntentId: booking.stripePaymentIntentId,
          stripeSessionId: booking.stripeSessionId,
        });

      if (!resolvedPaymentIntentId) {
        return next(
          new AppError(
            'This booking was paid but has no Stripe payment on file. Contact support to refund manually.',
            400,
          ),
        );
      }

      const stripeRefund = await stripeService.refundPayment(
        resolvedPaymentIntentId,
      );
      refundProcessed = true;
      stripeRefundId = stripeRefund.id;
      refundAmount =
        stripeRefund.amount != null
          ? stripeRefund.amount / 100
          : Number(booking.amountPaid);
      refundCurrency = (
        stripeRefund.currency ||
        booking.currency ||
        'GBP'
      ).toUpperCase();
    } else {
      refundNote = `No card refund: payment status is ${booking.paymentStatus || 'unknown'} (only SUCCEEDED/PAID bookings are refunded).`;
    }

    const updatedBooking = await prisma.courseBooking.update({
      where: { id: bookingId },
      data: {
        bookingStatus: 'CANCELLED',
        paymentStatus: refundProcessed ? 'REFUNDED' : booking.paymentStatus,
        ...(resolvedPaymentIntentId && !booking.stripePaymentIntentId
          ? { stripePaymentIntentId: resolvedPaymentIntentId }
          : {}),
      },
      include: {
        course: true,
        professional: {
          select: bookedProfessionalSelect,
        },
        attachedDocuments: {
          select: bookingDocumentSelect,
        },
        sessions: true,
      },
    });

    if (updatedBooking.sessions.length > 0) {
      await Promise.all(
        updatedBooking.sessions.map((session) =>
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

    const rejectionAlert = await prisma.alert.create({
      data: {
        professionalId: booking.professionalId,
        type: 'COURSE_BOOKING_STATUS',
        title: refundProcessed
          ? 'Course Booking Rejected and Refunded'
          : 'Course Booking Rejected',
        message: refundProcessed
          ? `Your booking for "${updatedBooking.course.title}" was rejected. A full refund has been issued to your card and may take 5–10 business days to appear.`
          : `Your booking for "${updatedBooking.course.title}" was rejected.`,
        metadata: {
          bookingId: booking.id,
          courseTitle: updatedBooking.course.title,
          status: 'CANCELLED',
          refundProcessed,
          paymentStatus: refundProcessed ? 'REFUNDED' : booking.paymentStatus,
        },
      },
    });

    const io = req.app.get('io');
    if (io) {
      io.to(booking.professionalId).emit('professional_alert', {
        alert: rejectionAlert,
      });
    }

    safeNotify('course-booking-cancelled', () =>
      notifyCourseBookingCancelled({
        bookingId: booking.id,
        cancelledBy: 'PROVIDER',
        refunded: refundProcessed,
      }),
    );

    const refund = {
      processed: refundProcessed,
      amount: refundAmount,
      currency: refundCurrency,
      stripeRefundId,
      stripePaymentIntentId: resolvedPaymentIntentId,
      note: refundNote,
    };

    const message = refundProcessed
      ? `Attendee rejected. ${refundAmount} ${refundCurrency} is being refunded to the professional's card (usually 5–10 business days).`
      : refundNote
        ? `Attendee rejected. ${refundNote}`
        : 'Attendee rejected successfully.';

    res.status(200).json({
      status: 'success',
      refundProcessed,
      message,
      data: {
        booking: updatedBooking,
        refundProcessed,
        refund,
      },
    });
  },
);

/**
 * Send message to trainee
 */
export const messageTrainee = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const { bookingId } = req.params;
    const recruiterId = req.user?.id;
    const validatedData = messageTraineeSchema.parse(req.body);

    if (!recruiterId) {
      return next(new AppError('Unauthorized', 401));
    }

    // Verify ownership
    const booking = await prisma.courseBooking.findFirst({
      where: {
        id: bookingId,
        course: {
          recruiterId,
        },
      },
      include: {
        professional: {
          select: {
            id: true,
            email: true,
            fullname: true,
          },
        },
        course: {
          select: {
            title: true,
          },
        },
      },
    });

    if (!booking) {
      return next(new AppError('Booking not found', 404));
    }

    // Create conversation message
    let conversation = await prisma.conversation.findFirst({
      where: {
        OR: [
          {
            professionalId: booking.professionalId,
            recruiterId,
          },
          {
            professionalId: booking.professionalId,
            recruiterId,
          },
        ],
      },
    });

    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: {
          professionalId: booking.professionalId,
          recruiterId,
        },
      });
    }

    const message = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        senderId: recruiterId,
        senderType: 'RECRUITER',
        content: `[Course: ${booking.course.title}]\n\n${validatedData.message}`,
      },
    });

    res.status(201).json({
      status: 'success',
      data: { message },
    });
  },
);

/**
 * Issue course completion certificate
 */
export const issueCertificate = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const { bookingId } = req.params;
    const recruiterId = req.user?.id;
    const { certificateUrl, certificateName } = req.body;

    if (!recruiterId) {
      return next(new AppError('Unauthorized', 401));
    }

    if (!certificateUrl || !certificateName) {
      return next(new AppError('Certificate URL and name are required', 400));
    }

    // Verify ownership
    const booking = await prisma.courseBooking.findFirst({
      where: {
        id: bookingId,
        course: {
          recruiterId,
        },
      },
      include: {
        course: {
          select: {
            title: true,
            category: true,
            certificationProvided: true,
          },
        },
      },
    });

    if (!booking) {
      return next(new AppError('Booking not found', 404));
    }

    // Add certificate to professional's document wallet
    const document = await prisma.professionalDocument.create({
      data: {
        professionalId: booking.professionalId,
        // @ts-expect-error - Prisma document category mapping mismatch
        category: booking.course.category,
        name: certificateName,
        number: `CERT-${Date.now()}`,
        issuingCountry: 'N/A',
        issueDate: new Date(),
        fileUrl: certificateUrl,
      },
    });

    // Update booking status to COMPLETED
    const updatedBooking = await prisma.courseBooking.update({
      where: { id: bookingId },
      data: {
        bookingStatus: 'COMPLETED',
      },
    });

    res.status(201).json({
      status: 'success',
      data: {
        booking: updatedBooking,
        certificate: document,
      },
    });
  },
);
