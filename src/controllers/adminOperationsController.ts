import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/prisma.js';
import { AppError } from '../utils/AppError.js';
import { catchAsync } from '../utils/catchAsync.js';
// Removed unused imports
import { CustomRequest } from '../types/index.js';

// --- Activity Logs ---

export const getActivityLogs = catchAsync(
  async (req: Request, res: Response) => {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    const { action, actorType, status } = req.query;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {};
    if (action)
      where.action = { contains: action as string, mode: 'insensitive' };
    if (actorType) where.actorType = actorType;
    if (status) where.status = status;

    const [logs, total] = await Promise.all([
      prisma.activityLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.activityLog.count({ where }),
    ]);

    res.status(200).json({
      status: 'success',
      results: logs.length,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
      data: { logs },
    });
  },
);

export const getSystemStats = catchAsync(
  async (req: Request, res: Response) => {
    // 1. Total Activities (Today)
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const activitiesToday = await prisma.activityLog.count({
      where: { createdAt: { gte: todayStart } },
    });

    // 2. Active Users (Online now - verified by recent activity in last 15 mins)
    const fifteenMinsAgo = new Date(Date.now() - 15 * 60 * 1000);
    // This is an approximation based on logs. Real-time online users are tracked in socket service.
    const activeUsers = await prisma.activityLog.groupBy({
      by: ['actorId'],
      where: { createdAt: { gte: fifteenMinsAgo } },
    });

    // 3. Failed Actions
    const failedActions = await prisma.activityLog.count({
      where: {
        status: 'FAILED',
        createdAt: { gte: todayStart },
      },
    });

    // 4. Security Alerts (Failed logins or bans)
    const securityAlerts = await prisma.activityLog.count({
      where: {
        action: { in: ['LOGIN_FAILED', 'USER_BANNED'] },
        status: 'WARNING',
        createdAt: { gte: todayStart },
      },
    });

    res.status(200).json({
      status: 'success',
      data: {
        activitiesToday,
        activeUsers: activeUsers.length,
        failedActions,
        securityAlerts,
      },
    });
  },
);

// --- Support Cases ---

export const getSupportCases = catchAsync(
  async (req: Request, res: Response) => {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    const { status, priority, userId } = req.query;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {};
    if (status) where.status = status;
    if (priority) where.priority = priority;
    if (userId) where.userId = userId;

    const [cases, total] = await Promise.all([
      prisma.supportCase.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          assignedTo: { select: { id: true, email: true } }, // Minimal admin info
        },
      }),
      prisma.supportCase.count({ where }),
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

export const createSupportCase = catchAsync(
  async (req: Request, res: Response) => {
    const { subject, description, category, priority, userId, userType } =
      req.body;

    // Generate a friendly ID (SC-XXXX)
    const count = await prisma.supportCase.count();
    const caseId = `SC-${2000 + count + 1}`;

    const newCase = await prisma.supportCase.create({
      data: {
        caseId,
        subject,
        description,
        category,
        priority: priority || 'MEDIUM',
        userId,
        userType,
      },
    });

    res.status(201).json({
      status: 'success',
      data: { case: newCase },
    });
  },
);

export const getCaseById = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;

    const supportCase = await prisma.supportCase.findFirst({
      where: { OR: [{ id }, { caseId: id }] },
      include: {
        assignedTo: { select: { id: true, email: true } },
        notes: {
          include: { admin: { select: { id: true, email: true } } },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!supportCase) {
      return next(new AppError('No case found with that ID', 404));
    }

    res.status(200).json({
      status: 'success',
      data: { case: supportCase },
    });
  },
);

export const updateCaseStatus = catchAsync(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const { status, priority, assignedToId } = req.body;

    const updatedCase = await prisma.supportCase.update({
      where: { id }, // Assuming ID is UUID from URL
      data: {
        status,
        priority,
        assignedToId,
      },
    });

    res.status(200).json({
      status: 'success',
      data: { case: updatedCase },
    });
  },
);

export const addCaseNote = catchAsync(
  async (req: CustomRequest, res: Response) => {
    const { id } = req.params;
    const { content, isInternal } = req.body;
    const adminId = req.user?.id; // From adminAuthMiddleware

    if (!adminId) {
      throw new AppError('Admin not authenticated', 401);
    }

    const note = await prisma.caseNote.create({
      data: {
        caseId: id,
        adminId,
        content,
        isInternal: isInternal ?? true,
      },
    });

    res.status(201).json({
      status: 'success',
      data: { note },
    });
  },
);
