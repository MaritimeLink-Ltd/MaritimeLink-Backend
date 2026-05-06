import { Response, NextFunction } from 'express';
import { prisma } from '../config/prisma.js';
import { AppError } from '../utils/AppError.js';
import { catchAsync } from '../utils/catchAsync.js';
import { logActivity } from '../services/activityLogger.js';
import { CustomRequest } from '../types/index.js';
import { ActorType, CasePriority } from '../generated/client/index.js';

export const createCase = catchAsync(
  async (req: CustomRequest, res: Response) => {
    const { subject, description, category, priority } = req.body;
    const user = req.user; // Attached by auth middleware

    if (!user) {
      throw new AppError('User not authenticated', 401);
    }

    const normalizedSubject = String(subject || '').trim();
    const normalizedDescription = String(description || '').trim();
    const normalizedCategory = String(category || '').trim();
    const normalizedPriority = String(
      priority || CasePriority.MEDIUM,
    ).toUpperCase();

    if (!normalizedSubject || !normalizedDescription || !normalizedCategory) {
      throw new AppError(
        'Subject, description, and category are required',
        400,
      );
    }

    const safePriority = Object.values(CasePriority).includes(
      normalizedPriority as CasePriority,
    )
      ? (normalizedPriority as CasePriority)
      : CasePriority.MEDIUM;

    // Determine user type based on the middleware used
    // Recruiter middleware adds 'role', Professional doesn't (in current implementation)
    // Or check endpoint path, but better to check user object structure if possible.
    // Ideally, we pass the userType explicitly from the route or infer it.
    // For now, let's look at the actor type passed in or infer it.

    // NOTE: protectRecruiter adds 'role' to req.user. protect (professional) does not.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const userType = (user as any).role
      ? ActorType.RECRUITER
      : ActorType.PROFESSIONAL;

    const count = await prisma.supportCase.count();
    const caseId = `SC-${2000 + count + 1}`;

    const newCase = await prisma.supportCase.create({
      data: {
        caseId,
        subject: normalizedSubject,
        description: normalizedDescription,
        category: normalizedCategory,
        priority: safePriority,
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

    res.status(201).json({
      status: 'success',
      data: { case: newCase },
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
      data: { cases },
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
      data: { case: supportCase },
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
