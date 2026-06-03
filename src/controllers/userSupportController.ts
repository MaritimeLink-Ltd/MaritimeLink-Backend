import { Response, NextFunction } from 'express';
import { prisma } from '../config/prisma.js';
import { AppError } from '../utils/AppError.js';
import { catchAsync } from '../utils/catchAsync.js';
import { logActivity } from '../services/activityLogger.js';
import { CustomRequest } from '../types/index.js';
import { ActorType, CasePriority } from '../generated/client/index.js';
import {
  deriveUserSupportCasePriority,
  normalizeStoredCasePriority,
} from '../utils/supportCasePriority.js';
import {
  notifySupportCaseEvent,
  safeNotify,
} from '../services/eventNotificationService.js';

export const createCase = catchAsync(
  async (req: CustomRequest, res: Response) => {
    const { subject, description, category } = req.body;
    const user = req.user; // Attached by auth middleware

    if (!user) {
      throw new AppError('User not authenticated', 401);
    }

    const normalizedSubject = String(subject || '').trim();
    const normalizedDescription = String(description || '').trim();
    const normalizedCategory = String(category || '').trim();
    if (!normalizedSubject || !normalizedDescription || !normalizedCategory) {
      throw new AppError(
        'Subject, description, and category are required',
        400,
      );
    }

    const isStaffAccount = Boolean((user as { role?: string }).role);
    const userType = isStaffAccount
      ? ActorType.RECRUITER
      : ActorType.PROFESSIONAL;

    let derivedPriority: CasePriority = CasePriority.LOW;
    if (!isStaffAccount) {
      const professional = await prisma.professional.findUnique({
        where: { id: user.id },
        select: { tier: true },
      });
      derivedPriority = deriveUserSupportCasePriority(
        false,
        professional?.tier,
      );
    }

    const count = await prisma.supportCase.count();
    const caseId = `SC-${2000 + count + 1}`;

    const newCase = await prisma.supportCase.create({
      data: {
        caseId,
        subject: normalizedSubject,
        description: normalizedDescription,
        category: normalizedCategory,
        priority: derivedPriority,
        userId: user.id,
        userType,
      },
    });

    await logActivity({
      action: 'CASE_CREATED',
      actorId: user.id,
      actorType: userType,
      targetId: newCase.id,
      targetType: 'SupportCase',
      status: 'SUCCESS',
      metadata: { caseId: newCase.caseId },
    });

    safeNotify('support-case-created', () =>
      notifySupportCaseEvent({ caseDbId: newCase.id, event: 'created' }),
    );

    res.status(201).json({
      status: 'success',
      data: {
        case: {
          ...newCase,
          priority: normalizeStoredCasePriority(newCase.priority),
        },
      },
    });
  },
);

export const getMyCases = catchAsync(
  async (req: CustomRequest, res: Response) => {
    const user = req.user;
    if (!user) throw new AppError('User not authenticated', 401);

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    const [cases, total] = await Promise.all([
      prisma.supportCase.findMany({
        where: { userId: user.id },
        skip,
        take: limit,
        orderBy: { updatedAt: 'desc' },
      }),
      prisma.supportCase.count({ where: { userId: user.id } }),
    ]);

    res.status(200).json({
      status: 'success',
      results: cases.length,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
      data: {
        cases: cases.map((c) => ({
          ...c,
          priority: normalizeStoredCasePriority(c.priority),
        })),
      },
    });
  },
);

export const getCaseDetails = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const { id } = req.params;
    const user = req.user;
    if (!user) throw new AppError('User not authenticated', 401);

    const supportCase = await prisma.supportCase.findFirst({
      where: {
        OR: [{ id }, { caseId: id }],
        userId: user.id, // Ensure user owns the case
      },
      include: {
        notes: {
          where: { isInternal: false }, // Only show public notes/replies
          orderBy: { createdAt: 'asc' },
          include: { admin: { select: { email: true } } }, // Show who replied
        },
      },
    });

    if (!supportCase) {
      return next(new AppError('Case not found or access denied', 404));
    }

    res.status(200).json({
      status: 'success',
      data: {
        case: {
          ...supportCase,
          priority: normalizeStoredCasePriority(supportCase.priority),
        },
      },
    });
  },
);

export const addReply = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const { id } = req.params;
    const { content } = req.body;
    const user = req.user;
    if (!user) throw new AppError('User not authenticated', 401);

    const supportCase = await prisma.supportCase.findFirst({
      where: {
        OR: [{ id }, { caseId: id }],
        userId: user.id,
      },
    });

    if (!supportCase) {
      return next(new AppError('Case not found or access denied', 404));
    }

    const note = await prisma.caseNote.create({
      data: {
        caseId: supportCase.id,
        authorId: user.id,
        content,
        isInternal: false,
      },
    });

    await logActivity({
      action: 'CASE_REPLY',
      actorId: user.id,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      actorType: (user as any).role
        ? ActorType.RECRUITER
        : ActorType.PROFESSIONAL,
      targetId: supportCase.id,
      targetType: 'SupportCase',
      status: 'SUCCESS',
      metadata: { noteId: note.id },
    });

    res.status(201).json({
      status: 'success',
      data: { note },
    });
  },
);
