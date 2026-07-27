import { Response, NextFunction } from 'express';
import { prisma } from '../config/prisma.js';
import { catchAsync } from '../utils/catchAsync.js';
import { AppError } from '../utils/AppError.js';
import { CustomRequest } from '../types/index.js';
import {
  ActionStatus,
  ActorType,
  ReportAction,
  ReportStatus,
} from '../generated/client/index.js';
import { logActivity } from '../services/activityLogger.js';
import { getClientIp } from '../utils/requestMetadata.js';
import {
  notifyReportResolved,
  safeNotify,
} from '../services/eventNotificationService.js';
import { REPORT_REASON_LABELS } from './userReportController.js';

/**
 * Admin review queue for member-to-member reports. Reviewing a report never
 * changes an account's status by itself — the admin records what they decided
 * here, then applies suspend/block through the moderation endpoints.
 */

const REPORT_STATUSES = Object.values(ReportStatus);
const REPORT_ACTIONS = Object.values(ReportAction);

const ACTION_OUTCOME_LABELS: Record<ReportAction, string> = {
  NONE: 'No breach of policy was found.',
  WARNING_ISSUED: 'A warning was issued to the reported account.',
  ACCOUNT_SUSPENDED: 'The reported account has been suspended.',
  ACCOUNT_BLOCKED: 'The reported account has been permanently suspended.',
};

const decorate = (report: {
  reason: keyof typeof REPORT_REASON_LABELS;
  [key: string]: unknown;
}) => ({
  ...report,
  reasonLabel: REPORT_REASON_LABELS[report.reason] || report.reason,
});

/**
 * GET /api/admin/reports?status=&reason=&page=&limit=
 */
export const getReports = catchAsync(
  async (req: CustomRequest, res: Response) => {
    const page = Math.max(parseInt(String(req.query.page || '1'), 10) || 1, 1);
    const limit = Math.min(
      Math.max(parseInt(String(req.query.limit || '25'), 10) || 25, 1),
      100,
    );
    const statusFilter = String(req.query.status || '').toUpperCase();
    const reasonFilter = String(req.query.reason || '').toUpperCase();
    const reportedId = String(req.query.reportedId || '').trim();

    const where: Record<string, unknown> = {};
    if (statusFilter && statusFilter !== 'ALL') {
      if (!REPORT_STATUSES.includes(statusFilter as ReportStatus)) {
        throw new AppError('Invalid report status filter', 400);
      }
      where.status = statusFilter as ReportStatus;
    }
    if (reasonFilter && reasonFilter !== 'ALL') {
      where.reason = reasonFilter;
    }
    if (reportedId) {
      where.reportedId = reportedId;
    }

    const [reports, total] = await Promise.all([
      prisma.userReport.findMany({
        where,
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: {
          reviewedBy: { select: { id: true, email: true } },
        },
      }),
      prisma.userReport.count({ where }),
    ]);

    res.status(200).json({
      status: 'success',
      results: reports.length,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      data: { reports: reports.map(decorate) },
    });
  },
);

/**
 * GET /api/admin/reports/stats — queue counters for the dashboard header.
 */
export const getReportStats = catchAsync(
  async (_req: CustomRequest, res: Response) => {
    const [total, pending, underReview, actioned, dismissed] =
      await Promise.all([
        prisma.userReport.count(),
        prisma.userReport.count({ where: { status: ReportStatus.PENDING } }),
        prisma.userReport.count({
          where: { status: ReportStatus.UNDER_REVIEW },
        }),
        prisma.userReport.count({ where: { status: ReportStatus.ACTIONED } }),
        prisma.userReport.count({ where: { status: ReportStatus.DISMISSED } }),
      ]);

    res.status(200).json({
      status: 'success',
      data: { total, pending, underReview, actioned, dismissed },
    });
  },
);

/**
 * GET /api/admin/reports/:id — report plus every other report against the same
 * account, so a repeat offender is visible at a glance.
 */
export const getReportById = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const { id } = req.params;

    const report = await prisma.userReport.findFirst({
      where: { OR: [{ id }, { reference: id }] },
      include: {
        reviewedBy: { select: { id: true, email: true } },
        notes: {
          orderBy: { createdAt: 'asc' },
          include: { admin: { select: { id: true, email: true } } },
        },
      },
    });

    if (!report) return next(new AppError('Report not found', 404));

    const [otherReports, reportedAccount] = await Promise.all([
      prisma.userReport.findMany({
        where: { reportedId: report.reportedId, NOT: { id: report.id } },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          reference: true,
          reason: true,
          status: true,
          createdAt: true,
          reporterName: true,
        },
      }),
      report.reportedType === ActorType.PROFESSIONAL
        ? prisma.professional.findUnique({
            where: { id: report.reportedId },
            select: {
              id: true,
              email: true,
              status: true,
              suspendedAt: true,
              suspendedUntil: true,
              suspensionReason: true,
            },
          })
        : prisma.recruiter.findUnique({
            where: { id: report.reportedId },
            select: {
              id: true,
              email: true,
              role: true,
              status: true,
              suspendedAt: true,
              suspendedUntil: true,
              suspensionReason: true,
            },
          }),
    ]);

    // The reported thread, when the reporter attached one.
    const conversation = report.conversationId
      ? await prisma.conversation.findUnique({
          where: { id: report.conversationId },
          select: {
            id: true,
            createdAt: true,
            messages: {
              orderBy: { createdAt: 'desc' },
              take: 30,
              select: {
                id: true,
                senderType: true,
                senderId: true,
                content: true,
                createdAt: true,
              },
            },
          },
        })
      : null;

    res.status(200).json({
      status: 'success',
      data: {
        report: decorate(report),
        otherReports: otherReports.map(decorate),
        reportedAccount,
        conversation,
      },
    });
  },
);

/**
 * PATCH /api/admin/reports/:id
 * Body: { status?, actionTaken?, resolutionNote? }
 */
export const updateReport = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const { id } = req.params;
    const adminId = req.user!.id;

    const existing = await prisma.userReport.findFirst({
      where: { OR: [{ id }, { reference: id }] },
    });
    if (!existing) return next(new AppError('Report not found', 404));

    const nextStatus = req.body?.status
      ? (String(req.body.status).toUpperCase() as ReportStatus)
      : undefined;
    const nextAction = req.body?.actionTaken
      ? (String(req.body.actionTaken).toUpperCase() as ReportAction)
      : undefined;
    const resolutionNote =
      req.body?.resolutionNote !== undefined
        ? String(req.body.resolutionNote || '').trim() || null
        : undefined;

    if (nextStatus && !REPORT_STATUSES.includes(nextStatus)) {
      return next(new AppError('Invalid report status', 400));
    }
    if (nextAction && !REPORT_ACTIONS.includes(nextAction)) {
      return next(new AppError('Invalid report action', 400));
    }

    const isClosing =
      nextStatus === ReportStatus.ACTIONED ||
      nextStatus === ReportStatus.DISMISSED;

    if (isClosing && !resolutionNote && !existing.resolutionNote) {
      return next(
        new AppError('A resolution note is required to close a report', 400),
      );
    }

    const report = await prisma.userReport.update({
      where: { id: existing.id },
      data: {
        ...(nextStatus ? { status: nextStatus } : {}),
        ...(nextAction ? { actionTaken: nextAction } : {}),
        ...(resolutionNote !== undefined ? { resolutionNote } : {}),
        ...(isClosing
          ? { reviewedById: adminId, reviewedAt: new Date() }
          : nextStatus === ReportStatus.UNDER_REVIEW
            ? { reviewedById: adminId }
            : {}),
      },
      include: { reviewedBy: { select: { id: true, email: true } } },
    });

    await logActivity({
      action: 'REPORT_REVIEWED',
      actorId: adminId,
      actorType: ActorType.ADMIN,
      targetId: report.reportedId,
      targetType:
        report.reportedType === ActorType.PROFESSIONAL
          ? 'Professional'
          : 'Recruiter',
      status: ActionStatus.SUCCESS,
      ipAddress: getClientIp(req),
      userAgent: req.get('user-agent'),
      metadata: {
        reference: report.reference,
        status: report.status,
        actionTaken: report.actionTaken,
      },
    });

    if (isClosing && report.reporterEmail) {
      safeNotify('report-resolved', () =>
        notifyReportResolved({
          to: report.reporterEmail!,
          recipientName: report.reporterName || 'there',
          reference: report.reference,
          reportedName: report.reportedName || 'the reported account',
          outcome: ACTION_OUTCOME_LABELS[report.actionTaken],
        }),
      );
    }

    res.status(200).json({
      status: 'success',
      message: 'Report updated',
      data: { report: decorate(report) },
    });
  },
);

/**
 * POST /api/admin/reports/:id/notes
 * Body: { content: string }
 *
 * Adds an internal, admin-only note without changing the report's status, so a
 * report can be worked on collaboratively before an outcome is recorded.
 */
export const addReportNote = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const { id } = req.params;
    const adminId = req.user!.id;

    const content = String(req.body?.content || '').trim();
    if (!content) {
      return next(new AppError('A note cannot be empty', 400));
    }
    if (content.length > 5000) {
      return next(new AppError('A note cannot exceed 5000 characters', 400));
    }

    const report = await prisma.userReport.findFirst({
      where: { OR: [{ id }, { reference: id }] },
      select: {
        id: true,
        reference: true,
        reportedId: true,
        reportedType: true,
      },
    });
    if (!report) return next(new AppError('Report not found', 404));

    // Denormalise the author's email so the audit trail survives admin deletion.
    const admin = await prisma.admin.findUnique({
      where: { id: adminId },
      select: { email: true },
    });

    const note = await prisma.reportNote.create({
      data: {
        reportId: report.id,
        adminId,
        adminEmail: admin?.email ?? null,
        content,
      },
      include: { admin: { select: { id: true, email: true } } },
    });

    await logActivity({
      action: 'REPORT_NOTE_ADDED',
      actorId: adminId,
      actorType: ActorType.ADMIN,
      targetId: report.reportedId,
      targetType:
        report.reportedType === ActorType.PROFESSIONAL
          ? 'Professional'
          : 'Recruiter',
      status: ActionStatus.SUCCESS,
      ipAddress: getClientIp(req),
      userAgent: req.get('user-agent'),
      metadata: { reference: report.reference, noteId: note.id },
    });

    res.status(201).json({
      status: 'success',
      message: 'Note added',
      data: { note },
    });
  },
);
