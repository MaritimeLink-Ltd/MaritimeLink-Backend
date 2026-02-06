import { Response, NextFunction } from 'express';
import { prisma } from '../config/prisma.js';
import { catchAsync } from '../utils/catchAsync.js';
import { AppError } from '../utils/AppError.js';
import { CustomRequest } from '../types/index.js';
import {
  updateBookingStatusSchema,
  messageTraineeSchema,
} from '../validations/jobValidation.js';

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
        session: {
          select: {
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
        session: {
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

    const updatedBooking = await prisma.courseBooking.update({
      where: { id: bookingId },
      data: {
        bookingStatus: validatedData.status,
      },
    });

    res.status(200).json({
      status: 'success',
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
