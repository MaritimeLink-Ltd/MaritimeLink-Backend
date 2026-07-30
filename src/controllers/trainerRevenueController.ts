import { Response, NextFunction } from 'express';
import { prisma } from '../config/prisma.js';
import { commissionFor, payoutFor } from '../config/commission.js';
import { catchAsync } from '../utils/catchAsync.js';
import { AppError } from '../utils/AppError.js';
import { CustomRequest } from '../types/index.js';

/**
 * Get trainer revenue breakdown
 */
export const getRevenue = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const recruiterId = req.user?.id;

    if (!recruiterId) {
      return next(new AppError('Unauthorized', 401));
    }

    // Get all paid bookings for this trainer
    const bookings = await prisma.courseBooking.findMany({
      where: {
        course: {
          recruiterId,
        },
        paymentStatus: 'SUCCEEDED',
      },
      include: {
        course: true,
      },
    });

    // Calculate revenue
    const totalRevenue = bookings.reduce(
      (sum, booking) => sum + Number(booking.amountPaid),
      0,
    );
    const platformFee = commissionFor(totalRevenue);
    const trainerPayout = payoutFor(totalRevenue);

    // Group by course
    const revenueByCourse = bookings.reduce(
      (acc, booking) => {
        const courseId = booking.courseId;
        if (!acc[courseId]) {
          acc[courseId] = {
            courseId,
            courseTitle: booking.course.title,
            bookings: 0,
            revenue: 0,
          };
        }
        acc[courseId].bookings += 1;
        acc[courseId].revenue += Number(booking.amountPaid);
        return acc;
      },
      {} as Record<
        string,
        {
          courseId: string;
          courseTitle: string;
          bookings: number;
          revenue: number;
        }
      >,
    );

    // Note: trainerPayout tracking requires Prisma client regeneration
    const pendingAmount = 0; // Placeholder until Prisma client is regenerated

    res.status(200).json({
      status: 'success',
      data: {
        summary: {
          totalRevenue,
          platformFee,
          trainerPayout,
          totalBookings: bookings.length,
          pendingPayouts: pendingAmount,
        },
        byCourse: Object.values(revenueByCourse),
      },
    });
  },
);

/**
 * Get course performance analytics
 */
export const getAnalytics = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const recruiterId = req.user?.id;

    if (!recruiterId) {
      return next(new AppError('Unauthorized', 401));
    }

    // Get all courses
    const courses = await prisma.course.findMany({
      where: { recruiterId },
      include: {
        bookings: {
          select: {
            bookingStatus: true,
            paymentStatus: true,
            amountPaid: true,
            createdAt: true,
          },
        },
        sessions: {
          select: {
            totalSeats: true,
            availableSeats: true,
          },
        },
      },
    });

    // Calculate analytics
    const analytics = courses.map((course) => {
      const totalBookings = course.bookings.length;
      const confirmedBookings = course.bookings.filter(
        (b) => b.bookingStatus === 'CONFIRMED',
      ).length;
      const completedBookings = course.bookings.filter(
        (b) => b.bookingStatus === 'COMPLETED',
      ).length;
      const revenue = course.bookings
        .filter((b) => b.paymentStatus === 'SUCCEEDED')
        .reduce((sum, b) => sum + Number(b.amountPaid), 0);

      const totalSeats = course.sessions.reduce(
        (sum, s) => sum + s.totalSeats,
        0,
      );
      const availableSeats = course.sessions.reduce(
        (sum, s) => sum + s.availableSeats,
        0,
      );
      const capacityUtilization =
        totalSeats > 0 ? ((totalSeats - availableSeats) / totalSeats) * 100 : 0;

      return {
        courseId: course.id,
        title: course.title,
        status: course.status,
        totalBookings,
        confirmedBookings,
        completedBookings,
        revenue,
        capacity: course.capacity,
        enrolledCount: course.enrolledCount,
        capacityUtilization: Math.round(capacityUtilization),
        createdAt: course.createdAt,
      };
    });

    // Overall stats
    const overallStats = {
      totalCourses: courses.length,
      activeCourses: courses.filter((c) => c.status === 'ACTIVE').length,
      totalBookings: analytics.reduce((sum, a) => sum + a.totalBookings, 0),
      totalRevenue: analytics.reduce((sum, a) => sum + a.revenue, 0),
      averageCapacityUtilization: Math.round(
        analytics.reduce((sum, a) => sum + a.capacityUtilization, 0) /
          analytics.length || 0,
      ),
    };

    res.status(200).json({
      status: 'success',
      data: {
        overall: overallStats,
        courses: analytics,
      },
    });
  },
);
