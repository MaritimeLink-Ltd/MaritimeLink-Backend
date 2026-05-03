import { Response, NextFunction } from 'express';
import { prisma } from '../config/prisma.js';
import { catchAsync } from '../utils/catchAsync.js';
import { AppError } from '../utils/AppError.js';
import { CustomRequest } from '../types/index.js';

/**
 * @desc    Get dashboard overview metrics
 * @route   GET /api/professional/dashboard/overview
 * @access  Private (Professional)
 */
export const getDashboardOverview = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const professionalId = req.user?.id;

    if (!professionalId) {
      return next(new AppError('User not authenticated', 401));
    }

    // 1. Fetch Professional with related data
    const professional = await prisma.professional.findUnique({
      where: { id: professionalId },
      include: {
        resume: {
          include: {
            skills: true,
            licenses: true,
            education: true,
            seaService: true,
          },
        },
        kyc: true,
        documents: true,
        applications: true,
        bookings: true,
      },
    });

    if (!professional) {
      return next(new AppError('Professional not found', 404));
    }

    // 2. Count Expiring Certificates (next 90 days)
    const ninetyDaysFromNow = new Date();
    ninetyDaysFromNow.setDate(ninetyDaysFromNow.getDate() + 90);

    const expiringCertsCount = professional.documents.filter(
      (doc) =>
        doc.expiryDate &&
        new Date(doc.expiryDate) <= ninetyDaysFromNow &&
        new Date(doc.expiryDate) > new Date(),
    ).length;

    // 3. Calculate Resume Completion Percentage
    // Basic heuristic: check existence of fields/relations
    let completionPoints = 0;
    const totalPoints = 8;

    if (professional.bio) completionPoints++;
    if (professional.profession) completionPoints++;
    if (professional.resume) {
      completionPoints++; // Has resume object
      if (professional.resume.summary) completionPoints++;
      if (professional.resume.skills && professional.resume.skills.length > 0)
        completionPoints++;
      if (
        professional.resume.education &&
        professional.resume.education.length > 0
      )
        completionPoints++;
      if (
        professional.resume.licenses &&
        professional.resume.licenses.length > 0
      )
        completionPoints++;
      // Check for seaService
      const expCount = professional.resume.seaService?.length || 0;
      if (expCount > 0) completionPoints++;
    }

    const resumeCompletionPercentage = Math.round(
      (completionPoints / totalPoints) * 100,
    );

    // 4. Compliance Status
    // RED: KYC rejected or expired mandatory docs
    // AMBER: KYC pending or docs expiring soon
    // GREEN: KYC approved and all docs valid
    let complianceStatus = 'Fully Compliant';
    let documentWalletStatus = 'Fully Compliant';

    const hasExpiredDocs = professional.documents.some(
      (doc) => doc.expiryDate && new Date(doc.expiryDate) < new Date(),
    );

    if (professional.kyc?.status === 'REJECTED' || hasExpiredDocs) {
      complianceStatus = 'Red';
      documentWalletStatus = 'Action Required';
    } else if (
      professional.kyc?.status === 'PENDING' ||
      expiringCertsCount > 0
    ) {
      complianceStatus = 'Amber';
      documentWalletStatus = 'Review Required';
    }

    // 5. Jobs available to this professional (same availability rules as professional jobs feed)
    const availableJobsCount = await prisma.job.count({
      where: {
        status: 'ACTIVE',
        isFlagged: false,
        OR: [{ closingDate: null }, { closingDate: { gte: new Date() } }],
      },
    });

    // 6. Courses available to this professional (same availability rules as browse courses)
    const rawCourses = await prisma.course.findMany({
      where: {
        status: 'ACTIVE',
        bookings: {
          none: {
            professionalId,
            bookingStatus: { in: ['PENDING', 'CONFIRMED', 'COMPLETED'] },
          },
        },
      },
      include: {
        sessions: {
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

    const now = new Date();
    const availableCoursesCount = rawCourses.filter((course) =>
      course.sessions.some((session) => {
        const endsAt = new Date(session.endDate);
        const deadline = session.enrollmentDeadline
          ? new Date(session.enrollmentDeadline)
          : null;
        const sessionClosed =
          endsAt.getTime() < now.getTime() ||
          Boolean(deadline && deadline.getTime() < now.getTime());

        const reservedSeats = session.bookings.filter((booking) =>
          ['PENDING', 'CONFIRMED', 'COMPLETED'].includes(
            String(booking.bookingStatus || ''),
          ),
        ).length;
        const availableSeats = Math.max(
          0,
          Math.min(
            Number(session.availableSeats || session.totalSeats || 0),
            Number(session.totalSeats || 0) - reservedSeats,
          ),
        );

        return !sessionClosed && availableSeats > 0;
      }),
    ).length;

    res.status(200).json({
      status: 'success',
      data: {
        overview: {
          complianceStatus,
          expiringCertificates: {
            count: expiringCertsCount,
            timeframe: '90 days',
          },
          resumeCompletionPercentage,
          documentWalletStatus,
          jobMatchesCount: availableJobsCount,
          recommendedCoursesCount: availableCoursesCount,
        },
      },
    });
  },
);

/**
 * @desc    Get recent alerts
 * @route   GET /api/professional/dashboard/alerts
 * @access  Private (Professional)
 */
export const getAlerts = catchAsync(
  async (req: CustomRequest, res: Response) => {
    const alerts = await prisma.alert.findMany({
      where: { professionalId: req.user?.id },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    res.status(200).json({
      status: 'success',
      results: alerts.length,
      data: { alerts },
    });
  },
);

/**
 * @desc    Get recent activity
 * @route   GET /api/professional/dashboard/activity
 * @access  Private (Professional)
 */
export const getRecentActivity = catchAsync(
  async (req: CustomRequest, res: Response) => {
    const activity = await prisma.activityLog.findMany({
      where: {
        actorId: req.user?.id,
        actorType: 'PROFESSIONAL',
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    res.status(200).json({
      status: 'success',
      results: activity.length,
      data: { activity },
    });
  },
);

/**
 * @desc    Mark alert as read
 * @route   PATCH /api/professional/dashboard/alerts/:id/read
 * @access  Private (Professional)
 */
export const markAlertAsRead = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const { id } = req.params;

    const alert = await prisma.alert.findFirst({
      where: { id, professionalId: req.user?.id },
    });

    if (!alert) {
      return next(new AppError('Alert not found', 404));
    }

    await prisma.alert.update({
      where: { id },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });

    res.status(200).json({
      status: 'success',
      message: 'Alert marked as read',
    });
  },
);
