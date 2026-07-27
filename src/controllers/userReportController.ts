import { Response, NextFunction } from 'express';
import { prisma } from '../config/prisma.js';
import { catchAsync } from '../utils/catchAsync.js';
import { AppError } from '../utils/AppError.js';
import { CustomRequest } from '../types/index.js';
import {
  ActionStatus,
  ActorType,
  ReportReason,
  ReportStatus,
} from '../generated/client/index.js';
import { logActivity } from '../services/activityLogger.js';
import { getClientIp } from '../utils/requestMetadata.js';
import {
  notifyReportAcknowledged,
  safeNotify,
} from '../services/eventNotificationService.js';

/**
 * Member-to-member reporting.
 *
 * Distinct from support cases: a support case is the user asking us for help,
 * a report is the user flagging another account for moderation review.
 *
 * A user may only report an account they already have a relationship with —
 * a conversation, a job application, an invitation, or a course booking — so the
 * queue cannot be filled with reports against strangers.
 */

const REPORT_REASONS = Object.values(ReportReason);

export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  SCAM_OR_FRAUD: 'Scam or fraud',
  HARASSMENT_OR_ABUSE: 'Harassment or abuse',
  FAKE_ACCOUNT: 'Fake account or impersonation',
  INAPPROPRIATE_CONTENT: 'Inappropriate content',
  SPAM: 'Spam or unsolicited contact',
  PAYMENT_ISSUE: 'Payment issue',
  OTHER: 'Other',
};

type ReportableParty = {
  id: string;
  type: ActorType;
  name: string;
  email: string;
};

const professionalDisplayName = (p: {
  fullname: string | null;
  firstName: string | null;
  lastName: string | null;
}) =>
  p.fullname?.trim() ||
  [p.firstName, p.lastName].filter(Boolean).join(' ') ||
  'Maritime Professional';

const recruiterDisplayName = (r: {
  organizationName: string | null;
  firstName: string | null;
  lastName: string | null;
}) =>
  r.organizationName?.trim() ||
  [r.firstName, r.lastName].filter(Boolean).join(' ') ||
  'Recruiter';

/** Loads the account being reported from either table. */
const loadReportedParty = async (
  id: string,
): Promise<ReportableParty | null> => {
  const professional = await prisma.professional.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      fullname: true,
      firstName: true,
      lastName: true,
    },
  });
  if (professional) {
    return {
      id: professional.id,
      type: ActorType.PROFESSIONAL,
      name: professionalDisplayName(professional),
      email: professional.email,
    };
  }

  const recruiter = await prisma.recruiter.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      organizationName: true,
      firstName: true,
      lastName: true,
    },
  });
  if (recruiter) {
    return {
      id: recruiter.id,
      type: ActorType.RECRUITER,
      name: recruiterDisplayName(recruiter),
      email: recruiter.email,
    };
  }

  return null;
};

const loadReporterParty = async (
  id: string,
  userType: string,
): Promise<ReportableParty | null> => {
  if (userType === 'PROFESSIONAL') {
    const p = await prisma.professional.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        fullname: true,
        firstName: true,
        lastName: true,
      },
    });
    return p
      ? {
          id: p.id,
          type: ActorType.PROFESSIONAL,
          name: professionalDisplayName(p),
          email: p.email,
        }
      : null;
  }

  const r = await prisma.recruiter.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      organizationName: true,
      firstName: true,
      lastName: true,
    },
  });
  return r
    ? {
        id: r.id,
        type: ActorType.RECRUITER,
        name: recruiterDisplayName(r),
        email: r.email,
      }
    : null;
};

/**
 * True when the two accounts have interacted on the platform. Admins are exempt —
 * they moderate directly rather than reporting.
 */
const hasRelationship = async (
  reporter: ReportableParty,
  reported: ReportableParty,
): Promise<boolean> => {
  const professionalId =
    reporter.type === ActorType.PROFESSIONAL ? reporter.id : reported.id;
  const recruiterId =
    reporter.type === ActorType.RECRUITER ? reporter.id : reported.id;

  // Professional ↔ recruiter/trainer is the only cross-type pairing the platform
  // creates. Same-type pairs can still be reported off the back of a shared thread.
  if (reporter.type === reported.type) {
    const conversation = await prisma.conversation.findFirst({
      where: {
        OR: [
          { professionalId: reporter.id, recruiterId: reported.id },
          { professionalId: reported.id, recruiterId: reporter.id },
        ],
      },
      select: { id: true },
    });
    return Boolean(conversation);
  }

  const [conversation, application, invitation, booking] = await Promise.all([
    prisma.conversation.findFirst({
      where: { professionalId, recruiterId },
      select: { id: true },
    }),
    prisma.jobApplication.findFirst({
      where: { professionalId, job: { recruiterId } },
      select: { id: true },
    }),
    prisma.jobInvitation.findFirst({
      where: { professionalId, recruiterId },
      select: { id: true },
    }),
    prisma.courseBooking.findFirst({
      where: { professionalId, course: { recruiterId } },
      select: { id: true },
    }),
  ]);

  return Boolean(conversation || application || invitation || booking);
};

const buildReference = async () => {
  const count = await prisma.userReport.count();
  return `RPT-${1000 + count + 1}`;
};

/**
 * POST /api/reports
 * Body: { reportedId, reason, details, conversationId? }
 */
export const createReport = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) return next(new AppError('User not authenticated', 401));

    if (user.userType === 'ADMIN') {
      return next(
        new AppError(
          'Admins moderate accounts directly and cannot file reports.',
          403,
        ),
      );
    }

    const reportedId = String(req.body?.reportedId || '').trim();
    const reason = String(req.body?.reason || '').trim() as ReportReason;
    const details = String(req.body?.details || '').trim();
    const conversationId =
      String(req.body?.conversationId || '').trim() || null;

    if (!reportedId) {
      return next(new AppError('reportedId is required', 400));
    }
    if (!REPORT_REASONS.includes(reason)) {
      return next(
        new AppError(
          `reason must be one of: ${REPORT_REASONS.join(', ')}`,
          400,
        ),
      );
    }
    if (details.length < 10) {
      return next(
        new AppError(
          'Please describe the issue in at least 10 characters',
          400,
        ),
      );
    }
    if (reportedId === user.id) {
      return next(new AppError('You cannot report your own account', 400));
    }

    const [reporter, reported] = await Promise.all([
      loadReporterParty(user.id, user.userType || 'PROFESSIONAL'),
      loadReportedParty(reportedId),
    ]);

    if (!reporter) return next(new AppError('User not authenticated', 401));
    if (!reported) {
      return next(new AppError('The account you reported was not found', 404));
    }

    const related = await hasRelationship(reporter, reported);
    if (!related) {
      return next(
        new AppError(
          'You can only report an account you have interacted with on the platform.',
          403,
        ),
      );
    }

    // One open report per pair keeps the moderation queue meaningful; users can
    // file again once the previous one is closed.
    const existing = await prisma.userReport.findFirst({
      where: {
        reporterId: reporter.id,
        reportedId: reported.id,
        status: { in: [ReportStatus.PENDING, ReportStatus.UNDER_REVIEW] },
      },
      select: { id: true, reference: true },
    });
    if (existing) {
      return next(
        new AppError(
          `You already have an open report against this account (${existing.reference}). Our team is reviewing it.`,
          409,
        ),
      );
    }

    const report = await prisma.userReport.create({
      data: {
        reference: await buildReference(),
        reporterId: reporter.id,
        reporterType: reporter.type,
        reporterEmail: reporter.email,
        reporterName: reporter.name,
        reportedId: reported.id,
        reportedType: reported.type,
        reportedEmail: reported.email,
        reportedName: reported.name,
        reason,
        details,
        conversationId,
      },
    });

    await logActivity({
      action: 'ACCOUNT_REPORTED',
      actorId: reporter.id,
      actorType: reporter.type,
      targetId: reported.id,
      targetType:
        reported.type === ActorType.PROFESSIONAL ? 'Professional' : 'Recruiter',
      status: ActionStatus.WARNING,
      ipAddress: getClientIp(req),
      userAgent: req.get('user-agent'),
      metadata: {
        reference: report.reference,
        reason,
        reportedName: reported.name,
      },
    });

    safeNotify('report-acknowledged', () =>
      notifyReportAcknowledged({
        to: reporter.email,
        recipientName: reporter.name,
        reference: report.reference,
        reportedName: reported.name,
        reason: REPORT_REASON_LABELS[reason],
      }),
    );

    res.status(201).json({
      status: 'success',
      message: 'Report submitted. Our moderation team will review it.',
      data: { report },
    });
  },
);

/**
 * GET /api/reports/mine — reports filed by the authenticated user.
 */
export const getMyReports = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) return next(new AppError('User not authenticated', 401));

    const reports = await prisma.userReport.findMany({
      where: { reporterId: user.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        reference: true,
        reportedName: true,
        reportedType: true,
        reason: true,
        details: true,
        status: true,
        createdAt: true,
        reviewedAt: true,
      },
    });

    res.status(200).json({
      status: 'success',
      results: reports.length,
      data: { reports },
    });
  },
);

/**
 * GET /api/reports/reasons — reason list for the report form.
 */
export const getReportReasons = catchAsync(
  async (_req: CustomRequest, res: Response) => {
    res.status(200).json({
      status: 'success',
      data: {
        reasons: REPORT_REASONS.map((value) => ({
          value,
          label: REPORT_REASON_LABELS[value],
        })),
      },
    });
  },
);
