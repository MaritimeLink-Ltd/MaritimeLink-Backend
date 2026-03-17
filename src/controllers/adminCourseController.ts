import { Response, NextFunction } from 'express';
import { prisma } from '../config/prisma.js';
import { catchAsync } from '../utils/catchAsync.js';
import { AppError } from '../utils/AppError.js';
import { CustomRequest } from '../types/index.js';

export const getFlaggedCourses = catchAsync(
  async (req: CustomRequest, res: Response) => {
    const courses = await prisma.course.findMany({
      where: { isFlagged: true },
      include: {
        recruiter: {
          select: {
            id: true,
            organizationName: true,
            email: true,
          },
        },
        admin: {
          select: {
            id: true,
            email: true,
          },
        },
        _count: {
          select: {
            bookings: true,
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    res.status(200).json({
      status: 'success',
      results: courses.length,
      data: { courses },
    });
  },
);

/**
 * Get all bookings on platform (Admin)
 */
export const getAllBookings = catchAsync(
  async (req: CustomRequest, res: Response) => {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    const status = req.query.status as string;
    const paymentStatus = req.query.paymentStatus as string;

    const where: Record<string, string> = {};
    if (status) where.bookingStatus = status;
    if (paymentStatus) where.paymentStatus = paymentStatus;

    const bookings = await prisma.courseBooking.findMany({
      where,
      skip,
      take: limit,
      include: {
        course: {
          select: {
            id: true,
            title: true,
            category: true,
            price: true,
          },
        },
        professional: {
          select: {
            id: true,
            fullname: true,
            email: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const total = await prisma.courseBooking.count({ where });

    res.status(200).json({
      status: 'success',
      results: bookings.length,
      total,
      data: { bookings },
    });
  },
);

/**
 * Get specific booking by ID (Admin)
 */
export const getAdminBookingById = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const { bookingId } = req.params;

    const booking = await prisma.courseBooking.findUnique({
      where: { id: bookingId },
      include: {
        course: {
          include: {
            recruiter: {
              select: {
                id: true,
                organizationName: true,
                email: true,
              },
            },
          },
        },
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
 * Get all bookings for a specific course (Admin)
 */
export const getAdminCourseBookings = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const { courseId } = req.params;

    const course = await prisma.course.findUnique({
      where: { id: courseId },
    });

    if (!course) {
      return next(new AppError('Course not found', 404));
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
            startDate: true,
            endDate: true,
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
 * Get platform revenue overview
 */
export const getPlatformRevenue = catchAsync(
  async (req: CustomRequest, res: Response) => {
    // Get all successful bookings
    const bookings = await prisma.courseBooking.findMany({
      where: {
        paymentStatus: 'SUCCEEDED',
      },
      include: {
        course: {
          select: {
            id: true,
            title: true,
            recruiterId: true,
            recruiter: {
              select: {
                organizationName: true,
              },
            },
          },
        },
      },
    });

    const totalRevenue = bookings.reduce(
      (sum, b) => sum + Number(b.amountPaid),
      0,
    );
    const platformCommission = totalRevenue * 0.12;
    const trainerPayouts = totalRevenue * 0.88;

    // Calculate pending payouts (not yet processed)
    const pendingPayouts = bookings.filter(
      (b) => !b.trainerPayout || Number(b.trainerPayout) === 0,
    );
    const pendingAmount = pendingPayouts.reduce(
      (sum, b) => sum + Number(b.amountPaid) * 0.88,
      0,
    );

    // Group by trainer
    const revenueByTrainer = bookings.reduce(
      (acc, booking) => {
        const recruiterId = booking.course.recruiterId;
        if (!recruiterId) return acc;

        if (!acc[recruiterId]) {
          acc[recruiterId] = {
            recruiterId,
            organizationName:
              booking.course.recruiter?.organizationName || 'Unknown',
            bookings: 0,
            revenue: 0,
            payout: 0,
          };
        }
        acc[recruiterId].bookings += 1;
        acc[recruiterId].revenue += Number(booking.amountPaid);
        acc[recruiterId].payout += Number(booking.amountPaid) * 0.88;
        return acc;
      },
      {} as Record<
        string,
        {
          recruiterId: string;
          organizationName: string;
          bookings: number;
          revenue: number;
          payout: number;
        }
      >,
    );

    res.status(200).json({
      status: 'success',
      data: {
        summary: {
          totalRevenue,
          platformCommission,
          trainerPayouts,
          totalBookings: bookings.length,
          pendingPayouts: pendingAmount,
        },
        byTrainer: Object.values(revenueByTrainer),
      },
    });
  },
);

/**
 * Process payout to training provider
 */
export const processPayout = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const { providerId } = req.params;
    const { bookingIds } = req.body;

    if (!bookingIds || !Array.isArray(bookingIds) || bookingIds.length === 0) {
      return next(new AppError('Booking IDs are required', 400));
    }

    // Get bookings
    const bookings = await prisma.courseBooking.findMany({
      where: {
        id: { in: bookingIds },
        course: {
          recruiterId: providerId,
        },
        paymentStatus: 'SUCCEEDED',
      },
    });

    if (bookings.length === 0) {
      return next(new AppError('No valid bookings found', 404));
    }

    // Calculate payout amounts
    const updates = bookings.map((booking) => {
      const platformFee = Number(booking.amountPaid) * 0.12;
      const trainerPayout = Number(booking.amountPaid) * 0.88;

      return prisma.courseBooking.update({
        where: { id: booking.id },
        data: {
          platformFee,
          trainerPayout,
        },
      });
    });

    await prisma.$transaction(updates);

    const totalPayout = bookings.reduce(
      (sum, b) => sum + Number(b.amountPaid) * 0.88,
      0,
    );

    res.status(200).json({
      status: 'success',
      data: {
        processedBookings: bookings.length,
        totalPayout,
        providerId,
      },
    });
  },
);
