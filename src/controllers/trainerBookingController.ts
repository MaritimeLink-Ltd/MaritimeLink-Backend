import { Response, NextFunction } from 'express';
import { prisma } from '../config/prisma.js';
import { catchAsync } from '../utils/catchAsync.js';
import { AppError } from '../utils/AppError.js';
import { CustomRequest } from '../types/index.js';
import {
  updateBookingStatusSchema,
  messageTraineeSchema,
} from '../validations/jobValidation.js';
import { stripeService } from '../services/stripeService.js';
import {
  calculateTotalSeaTime,
  getExperienceSummary,
} from '../utils/experienceUtils.js';

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
          select: {
            id: true,
            fullname: true,
            email: true,
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
          },
        },
        professional: {
          select: {
            id: true,
            fullname: true,
            email: true,
          },
        },
        sessions: {
          select: {
            startDate: true,
            endDate: true,
            startTime: true,
            endTime: true,
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
          select: {
            id: true,
            fullname: true,
            email: true,
          },
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

    const previousStatus = booking.bookingStatus;
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

    // Handle Payout on Approval
    if (
      newStatus === 'CONFIRMED' &&
      previousStatus !== 'CONFIRMED' &&
      updatedBooking.paymentStatus === 'SUCCEEDED'
    ) {
      const trainer = updatedBooking.course.recruiter;
      if (trainer?.stripeAccountId && trainer?.stripeOnboardingComplete) {
        try {
          // Payout 82% to trainer
          const totalAmount = Number(updatedBooking.amountPaid);
          const trainerAmount = totalAmount * 0.82;

          await stripeService.createTransfer({
            amount: trainerAmount,
            currency: updatedBooking.currency,
            destinationAccountId: trainer.stripeAccountId,
            bookingId: updatedBooking.id,
          });

          // Track in ledger if needed (conceptual)
          console.log(
            `Pushed ${trainerAmount} to trainer ${trainer.stripeAccountId}`,
          );
        } catch (error) {
          console.error('Payout failed:', error);
          // In production, we'd log this to a failed_payouts table for retry
        }
      }
    }

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
              select: {
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
              },
            },
            professional: {
              select: {
                id: true,
                fullname: true,
                firstName: true,
                middleName: true,
                lastName: true,
                email: true,
                profession: true,
                subcategory: true,
                profilePhotoUrl: true,
                cvUrl: true,
                resume: {
                  select: {
                    summary: true,
                    skills: {
                      select: {
                        id: true,
                        skillName: true,
                        rating: true,
                      },
                    },
                    seaService: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!session) return next(new AppError('Session not found', 404));

    const attendees = session.bookings.map((b) => {
      const resume = b.professional.resume;
      const seaService = resume?.seaService || [];
      const totalSeaTime = calculateTotalSeaTime(seaService);
      const keySkillsAndCompetencies = resume?.skills || [];

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
        resume: {
          cvUrl: b.professional.cvUrl,
          summary: resume?.summary || null,
          experienceSummary: getExperienceSummary(seaService),
          totalSeaTime,
          keySkillsAndCompetencies,
          seaService,
        },
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
          include: {
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

    // Update status to COMPLETED (signifies completion and payout trigger)
    const updatedBooking = await prisma.courseBooking.update({
      where: { id: bookingId },
      data: { bookingStatus: 'COMPLETED' },
    });

    // Trigger Payout Logic
    if (updatedBooking.paymentStatus === 'SUCCEEDED') {
      const trainer = booking.course.recruiter;
      if (trainer?.stripeAccountId && trainer?.stripeOnboardingComplete) {
        try {
          const amount = Number(booking.amountPaid) * 0.82;
          await stripeService.createTransfer({
            amount,
            currency: booking.currency,
            destinationAccountId: trainer.stripeAccountId,
            bookingId: booking.id,
          });
          console.log(
            `Transferred ${amount} to trainer ${trainer.stripeAccountId}`,
          );
        } catch (err) {
          console.error('Approval-triggered payout failed:', err);
          // In real app, we would mark this for retry or notify admin
        }
      }
    }

    res.status(200).json({
      status: 'success',
      message:
        'Attendee approved successfully. Payout triggered if applicable.',
      data: { booking: updatedBooking },
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
