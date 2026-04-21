import { Response, NextFunction } from 'express';
import { prisma } from '../config/prisma.js';
import { catchAsync } from '../utils/catchAsync.js';
import { AppError } from '../utils/AppError.js';
import { CustomRequest } from '../types/index.js';
import { CourseStatus } from '../generated/client/index.js';

/**
 * @desc    Get training dashboard stats
 * @route   GET /api/trainer/dashboard/stats
 * @access  Private (Trainer)
 */
export const getTrainingDashboardStats = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const recruiterId = req.user?.id;
    if (!recruiterId) return next(new AppError('User not authenticated', 401));

    const timeframe = (req.query.timeframe as string) || '7d';

    // 1. Timeframe logic
    const now = new Date();
    const startDate = new Date();
    if (timeframe === 'today') {
      startDate.setHours(0, 0, 0, 0);
    } else if (timeframe === '7d') {
      startDate.setDate(now.getDate() - 7);
    } else {
      startDate.setDate(now.getDate() - 7);
    }

    // 2. Active Courses
    const activeCoursesCount = await prisma.course.count({
      where: { recruiterId, status: CourseStatus.ACTIVE },
    });

    // 3. New Bookings since timeframe
    const newBookingsCount = await prisma.courseBooking.count({
      where: {
        course: { recruiterId },
        createdAt: { gte: startDate },
      },
    });

    // 4. Demand Signals (Mocked or refined logic)
    const demandSignalsCount = 4; // Mock value as per requirement

    res.status(200).json({
      status: 'success',
      data: {
        stats: {
          activeCoursesCount,
          newBookingsCount,
          demandSignalsCount,
        },
      },
    });
  },
);

/**
 * @desc    Get items requiring training provider action
 * @route   GET /api/trainer/dashboard/action-items
 * @access  Private (Trainer)
 */
export const getTrainingActionItems = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const recruiterId = req.user?.id;
    if (!recruiterId) return next(new AppError('User not authenticated', 401));

    const actionItems: {
      type: string;
      message: string;
      action: string;
      courseId?: string;
      courseIds?: string[];
    }[] = [];

    // 1. Learners waiting for courses (Bookings with PENDING status?)
    const pendingBookings = await prisma.courseBooking.count({
      where: { course: { recruiterId }, bookingStatus: 'PENDING' },
    });

    if (pendingBookings > 0) {
      actionItems.push({
        type: 'LEARNERS_WAITING',
        message: `${pendingBookings} learners waiting for course confirmation`,
        action: 'VIEW_BOOKINGS',
      });
    }

    // 2. Courses near capacity (90% full)
    const criticalCourses = await prisma.course.findMany({
      where: { recruiterId, status: CourseStatus.ACTIVE },
      include: {
        _count: {
          select: { bookings: { where: { bookingStatus: 'CONFIRMED' } } },
        },
      },
    });

    criticalCourses.forEach((course) => {
      if (course.capacity && course._count.bookings >= course.capacity * 0.9) {
        actionItems.push({
          type: 'CAPACITY_ALERT',
          message: `Course '${course.title}' is 90% full`,
          action: 'VIEW_BOOKINGS',
          courseId: course.id,
        });
      }
    });

    // 3. Sessions needing scheduling (Courses with no upcoming sessions)
    const coursesNoSessions = await prisma.course.findMany({
      where: {
        recruiterId,
        status: CourseStatus.ACTIVE,
        sessions: { none: { startDate: { gte: new Date() } } },
      },
    });

    if (coursesNoSessions.length > 0) {
      actionItems.push({
        type: 'SESSIONS_NEEDED',
        message: `${coursesNoSessions.length} courses need session scheduling`,
        action: 'ADD_SESSION',
        courseIds: coursesNoSessions.map((c) => c.id),
      });
    }

    // 4. High demand alerts (Mocked)
    actionItems.push({
      type: 'HIGH_DEMAND',
      message:
        'High demand detected in Aberdeen - 67 professionals need renewal in 30 days',
      action: 'ADD_SESSION',
    });

    res.status(200).json({
      status: 'success',
      results: actionItems.length,
      data: { actionItems },
    });
  },
);

/**
 * @desc    Get training courses overview
 * @route   GET /api/trainer/dashboard/courses
 * @access  Private (Trainer)
 */
export const getTrainingCoursesOverview = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const recruiterId = req.user?.id;
    if (!recruiterId) return next(new AppError('User not authenticated', 401));

    const courses = await prisma.course.findMany({
      where: { recruiterId },
      include: {
        _count: {
          select: { bookings: { where: { bookingStatus: 'CONFIRMED' } } },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const enrichedCourses = courses.map((course) => {
      const capacityStatus = !course.capacity
        ? 'Open'
        : course._count.bookings >= course.capacity
          ? 'Full'
          : course._count.bookings >= course.capacity * 0.8
            ? 'Nearly Full'
            : 'Open';
      return {
        id: course.id,
        title: course.title,
        capacityStatus,
        bookingsCount: course._count.bookings,
        totalCapacity: course.capacity,
        status: course.status,
      };
    });

    res.status(200).json({
      status: 'success',
      results: enrichedCourses.length,
      data: { courses: enrichedCourses },
    });
  },
);

export const getTrainingNotifications = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const recruiterId = req.user?.id;
    if (!recruiterId) return next(new AppError('User not authenticated', 401));

    const [
      pendingBookings,
      coursesNoSessions,
      nearlyFullCourses,
      recentBookings,
    ] = await Promise.all([
      prisma.courseBooking.count({
        where: { course: { recruiterId }, bookingStatus: 'PENDING' },
      }),
      prisma.course.count({
        where: {
          recruiterId,
          status: CourseStatus.ACTIVE,
          sessions: { none: { startDate: { gte: new Date() } } },
        },
      }),
      prisma.course.findMany({
        where: { recruiterId, status: CourseStatus.ACTIVE },
        include: {
          _count: {
            select: { bookings: { where: { bookingStatus: 'CONFIRMED' } } },
          },
        },
        take: 5,
      }),
      prisma.courseBooking.findMany({
        where: { course: { recruiterId } },
        take: 5,
        orderBy: { createdAt: 'desc' },
        include: {
          professional: {
            select: { fullname: true, email: true },
          },
          course: {
            select: { title: true },
          },
        },
      }),
    ]);

    const capacityAlerts = nearlyFullCourses.filter(
      (course) =>
        course.capacity && course._count.bookings >= course.capacity * 0.8,
    );

    const notifications = [
      {
        id: 'trainer-announcement',
        type: 'announcement',
        severity: 'info',
        title: 'Training Provider Dashboard Update',
        message:
          'Booking alerts, course capacity warnings, and scheduling notifications are now live.',
        createdAt: new Date(),
      },
      pendingBookings > 0
        ? {
            id: 'pending-bookings',
            type: 'success',
            severity: 'success',
            title: 'New Booking Requests',
            message: `${pendingBookings} learners are waiting for booking confirmation.`,
            createdAt: new Date(),
          }
        : null,
      coursesNoSessions > 0
        ? {
            id: 'courses-no-sessions',
            type: 'warning',
            severity: 'warning',
            title: 'Sessions Needed',
            message: `${coursesNoSessions} active courses need upcoming sessions.`,
            createdAt: new Date(),
          }
        : null,
      ...capacityAlerts.map((course) => ({
        id: `capacity-${course.id}`,
        type: 'warning',
        severity: 'warning',
        title: 'Course Nearly Full',
        message: `"${course.title}" is close to capacity.`,
        createdAt: new Date(),
      })),
      ...recentBookings.map((booking) => ({
        id: booking.id,
        type: 'info',
        severity: 'info',
        title: 'Recent Course Booking',
        message: `${booking.professional.fullname || booking.professional.email} booked "${booking.course.title}".`,
        createdAt: booking.createdAt,
      })),
    ].filter(Boolean);

    res.status(200).json({
      status: 'success',
      results: notifications.length,
      data: { notifications },
    });
  },
);
