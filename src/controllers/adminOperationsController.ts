import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/prisma.js';
import { AppError } from '../utils/AppError.js';
import { catchAsync } from '../utils/catchAsync.js';
import { CustomRequest } from '../types/index.js';
import {
  ActionStatus,
  ActorType,
  AdminRole,
  RecruiterRole,
  CasePriority,
} from '../generated/client/index.js';
import {
  normalizeStoredCasePriority,
  isPremiumProfessionalTier,
} from '../utils/supportCasePriority.js';
import {
  notifySupportCaseEvent,
  safeNotify,
} from '../services/eventNotificationService.js';

type ActivityActor = {
  id: string;
  name: string;
  role: string;
  avatar: string;
  actorType: ActorType;
};

type ActivityMeta = {
  ip: string;
  device: string;
  location: string;
};

type EnrichedActivityLog = {
  id: string;
  timestamp: string;
  event: string;
  description: string;
  status: string;
  actor: ActivityActor;
  meta: ActivityMeta;
  action: string;
  targetId: string | null;
  targetType: string | null;
  rawLog: Record<string, unknown>;
};

type SupportUserSummary = {
  id: string;
  name: string;
  email: string | null;
  role: string;
  avatar: string;
  userType: string;
};

type SupportCaseNoteSummary = {
  id: string;
  content: string;
  isInternal: boolean;
  createdAt: string;
  author: {
    id: string;
    name: string;
    email: string | null;
    role: string;
    avatar: string;
  } | null;
};

const titleCase = (value: string) =>
  value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');

const humanizeAction = (action: string) => {
  const upper = action.toUpperCase();
  const map: Record<string, string> = {
    LOGIN: 'Login',
    REGISTER: 'Registration',
    JOB_CREATED: 'Job Posted',
    JOB_POSTED: 'Job Posted',
    JOB_APPLY: 'Job Applied',
    APPLICATION_STATUS_UPDATE: 'Hiring Update',
    COURSE_CREATED: 'Course Created',
    COURSE_DRAFT_CREATED: 'Course Draft Saved',
    COURSE_PUBLISHED: 'Course Published',
    COURSE_UNPUBLISHED: 'Course Unpublished',
    COURSE_PURCHASED: 'Purchase Completed',
    COURSE_PURCHASE_FAILED: 'Purchase Failed',
    CASE_CREATED: 'Support Case Created',
    CASE_REPLY: 'Support Reply Added',
    USER_BANNED: 'User Banned',
    USER_UNBANNED: 'User Unbanned',
  };

  if (map[upper]) return map[upper];
  return titleCase(upper.replace(/_/g, ' '));
};

const describeLog = (action: string, metadata: Record<string, unknown>) => {
  const courseTitle =
    typeof metadata.courseTitle === 'string' ? metadata.courseTitle : null;
  const jobTitle =
    typeof metadata.jobTitle === 'string' ? metadata.jobTitle : null;
  const caseId = typeof metadata.caseId === 'string' ? metadata.caseId : null;
  const status =
    typeof metadata.newStatus === 'string' ? metadata.newStatus : null;

  switch (action.toUpperCase()) {
    case 'LOGIN':
      return 'Signed in to the platform';
    case 'REGISTER':
      return 'Created a new account';
    case 'JOB_CREATED':
    case 'JOB_POSTED':
      return jobTitle
        ? `Published job listing "${jobTitle}"`
        : 'Published a job listing';
    case 'JOB_APPLY':
      return jobTitle ? `Applied to job "${jobTitle}"` : 'Applied to a job';
    case 'APPLICATION_STATUS_UPDATE':
      return status
        ? `Updated application status to ${titleCase(status)}`
        : 'Updated an application status';
    case 'COURSE_CREATED':
      return courseTitle
        ? `Created course "${courseTitle}"`
        : 'Created a course';
    case 'COURSE_DRAFT_CREATED':
      return courseTitle
        ? `Saved draft course "${courseTitle}"`
        : 'Saved a course draft';
    case 'COURSE_PUBLISHED':
      return courseTitle
        ? `Published course "${courseTitle}"`
        : 'Published a course';
    case 'COURSE_UNPUBLISHED':
      return courseTitle
        ? `Unpublished course "${courseTitle}"`
        : 'Unpublished a course';
    case 'COURSE_PURCHASED':
      return courseTitle
        ? `Completed payment for "${courseTitle}"`
        : 'Completed a course purchase';
    case 'COURSE_PURCHASE_FAILED':
      return courseTitle
        ? `Payment failed for "${courseTitle}"`
        : 'Course payment failed';
    case 'CASE_CREATED':
      return caseId ? `Opened support case ${caseId}` : 'Opened a support case';
    case 'CASE_REPLY':
      return caseId
        ? `Replied to support case ${caseId}`
        : 'Replied to a support case';
    default:
      return humanizeAction(action);
  }
};

const normalizeStatus = (status: ActionStatus | string) =>
  titleCase(String(status || 'SUCCESS'));

const buildAvatar = (name: string, seed = '') => {
  const initials =
    (name || 'System')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join('') || 'S';

  const palette = ['0D8ABC', '1E5A8F', '2563EB', '0F766E', '7C3AED', 'B45309'];
  const hashSource = `${name}:${seed}`;
  const index =
    hashSource.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0) %
    palette.length;
  const fill = palette[index];

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"><rect fill="#${fill}" width="40" height="40"/><text x="50%" y="50%" dy=".35em" fill="white" font-family="Arial" font-size="16" text-anchor="middle">${initials}</text></svg>`;

  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
};

const normalizeRoleLabel = (
  actorType: ActorType,
  role: string | null | undefined,
) => {
  if (actorType === ActorType.SYSTEM) return 'System';
  if (!role) return titleCase(actorType);
  return titleCase(role.replace(/_/g, ' '));
};

const deriveDeviceLabel = (userAgent?: string | null) => {
  if (!userAgent) return 'Unknown device';

  const browser = userAgent.includes('Chrome')
    ? 'Chrome'
    : userAgent.includes('Safari') && !userAgent.includes('Chrome')
      ? 'Safari'
      : userAgent.includes('Firefox')
        ? 'Firefox'
        : userAgent.includes('Edg')
          ? 'Edge'
          : userAgent.includes('Opera') || userAgent.includes('OPR')
            ? 'Opera'
            : 'Browser';

  const platform = userAgent.includes('Windows')
    ? 'Windows'
    : userAgent.includes('Mac OS X') || userAgent.includes('Macintosh')
      ? 'Mac'
      : userAgent.includes('Android')
        ? 'Android'
        : userAgent.includes('iPhone') || userAgent.includes('iPad')
          ? 'iOS'
          : userAgent.includes('Linux')
            ? 'Linux'
            : 'Unknown';

  return `${browser} / ${platform}`;
};

const getActorRecord = async (actorType: ActorType, actorId: string) => {
  switch (actorType) {
    case ActorType.ADMIN:
      return prisma.admin.findUnique({
        where: { id: actorId },
        select: { id: true, email: true, role: true },
      });
    case ActorType.RECRUITER:
      return prisma.recruiter.findUnique({
        where: { id: actorId },
        select: {
          id: true,
          email: true,
          role: true,
          organizationName: true,
          firstName: true,
          middleName: true,
          lastName: true,
          profilePhotoUrl: true,
        },
      });
    case ActorType.PROFESSIONAL:
      return prisma.professional.findUnique({
        where: { id: actorId },
        select: {
          id: true,
          email: true,
          fullname: true,
          firstName: true,
          middleName: true,
          lastName: true,
          profilePhotoUrl: true,
        },
      });
    default:
      return null;
  }
};

const buildActor = async (actorType: ActorType, actorId: string) => {
  if (actorType === ActorType.SYSTEM) {
    const name = 'System';
    return {
      id: actorId,
      name,
      role: 'System',
      avatar: buildAvatar(name, actorId),
      actorType,
    } satisfies ActivityActor;
  }

  const record = await getActorRecord(actorType, actorId);
  if (!record) {
    const fallbackName =
      actorType === ActorType.ADMIN ? 'Admin' : titleCase(actorType);
    return {
      id: actorId,
      name: fallbackName,
      role: normalizeRoleLabel(actorType, undefined),
      avatar: buildAvatar(fallbackName, actorId),
      actorType,
    } satisfies ActivityActor;
  }

  let name = 'Unknown user';
  let role = normalizeRoleLabel(actorType, 'UNKNOWN');
  let avatar = buildAvatar(name, actorId);

  if (actorType === ActorType.ADMIN) {
    const admin = record as { id: string; email: string; role: AdminRole };
    name = admin.email.split('@')[0] || 'Admin';
    role = normalizeRoleLabel(actorType, admin.role);
    avatar = buildAvatar(name, admin.id);
  } else if (actorType === ActorType.RECRUITER) {
    const recruiter = record as {
      id: string;
      email: string;
      role: RecruiterRole;
      organizationName: string | null;
      firstName: string | null;
      middleName: string | null;
      lastName: string | null;
      profilePhotoUrl: string | null;
    };
    const parts = [
      recruiter.firstName,
      recruiter.middleName,
      recruiter.lastName,
    ].filter(Boolean);
    name =
      parts.join(' ').trim() ||
      recruiter.organizationName?.trim() ||
      recruiter.email.split('@')[0] ||
      'Recruiter';
    role = normalizeRoleLabel(actorType, recruiter.role);
    avatar = recruiter.profilePhotoUrl || buildAvatar(name, recruiter.id);
  } else if (actorType === ActorType.PROFESSIONAL) {
    const professional = record as {
      id: string;
      email: string;
      fullname: string | null;
      firstName: string | null;
      middleName: string | null;
      lastName: string | null;
      profilePhotoUrl: string | null;
    };
    const parts = [
      professional.firstName,
      professional.middleName,
      professional.lastName,
    ].filter(Boolean);
    name =
      professional.fullname?.trim() ||
      parts.join(' ').trim() ||
      professional.email.split('@')[0] ||
      'Professional';
    role = normalizeRoleLabel(actorType, 'Professional');
    avatar = professional.profilePhotoUrl || buildAvatar(name, professional.id);
  }

  return {
    id: actorId,
    name,
    role,
    avatar,
    actorType,
  } satisfies ActivityActor;
};

const buildSupportAvatar = (name: string, seed = '') => buildAvatar(name, seed);

const getSupportUserSummary = async (
  userType: ActorType | null | undefined,
  userId: string | null | undefined,
) => {
  if (!userType || !userId) return null;

  const record = await getActorRecord(userType, userId);
  if (!record) {
    const fallbackName =
      userType === ActorType.ADMIN ? 'Admin' : titleCase(userType);
    return {
      id: userId,
      name: `${fallbackName} ${userId.slice(0, 8)}`,
      email: null,
      role: titleCase(userType),
      avatar: buildSupportAvatar(fallbackName, userId),
      userType: titleCase(userType),
    } satisfies SupportUserSummary;
  }

  if (userType === ActorType.ADMIN) {
    const admin = record as { id: string; email: string; role: AdminRole };
    return {
      id: admin.id,
      name: admin.email.split('@')[0].replace(/[._-]+/g, ' '),
      email: admin.email,
      role: normalizeRoleLabel(userType, admin.role),
      avatar: buildSupportAvatar(admin.email, admin.id),
      userType: 'Admin',
    } satisfies SupportUserSummary;
  }

  if (userType === ActorType.RECRUITER) {
    const recruiter = record as {
      id: string;
      email: string;
      role: string | null;
      organizationName: string | null;
      firstName: string | null;
      middleName: string | null;
      lastName: string | null;
      profilePhotoUrl: string | null;
    };
    const name =
      [recruiter.firstName, recruiter.middleName, recruiter.lastName]
        .filter(Boolean)
        .join(' ') ||
      recruiter.organizationName ||
      recruiter.email.split('@')[0];
    return {
      id: recruiter.id,
      name,
      email: recruiter.email,
      role:
        recruiter.role === 'TRAINING_AGENT' ? 'Training Provider' : 'Recruiter',
      avatar:
        recruiter.profilePhotoUrl || buildSupportAvatar(name, recruiter.id),
      userType:
        recruiter.role === 'TRAINING_AGENT' ? 'Training Provider' : 'Recruiter',
    } satisfies SupportUserSummary;
  }

  const professional = record as {
    id: string;
    email: string;
    fullname: string | null;
    firstName: string | null;
    middleName: string | null;
    lastName: string | null;
    profilePhotoUrl: string | null;
  };
  const name =
    professional.fullname ||
    [professional.firstName, professional.middleName, professional.lastName]
      .filter(Boolean)
      .join(' ') ||
    professional.email.split('@')[0];

  return {
    id: professional.id,
    name,
    email: professional.email,
    role: 'Professional',
    avatar:
      professional.profilePhotoUrl || buildSupportAvatar(name, professional.id),
    userType: 'Professional',
  } satisfies SupportUserSummary;
};

const deriveAdminSupportCasePriority = async (
  userType: unknown,
  userId: unknown,
): Promise<CasePriority> => {
  const ut = String(userType || '').toUpperCase();
  const uid =
    typeof userId === 'string' && userId.trim()
      ? userId.trim()
      : userId != null
        ? String(userId).trim()
        : '';
  if (ut === 'PROFESSIONAL' && uid) {
    const prof = await prisma.professional.findUnique({
      where: { id: uid },
      select: { tier: true },
    });
    return isPremiumProfessionalTier(prof?.tier)
      ? CasePriority.HIGH
      : CasePriority.LOW;
  }
  return CasePriority.LOW;
};

const formatAdminNoteAuthorName = (email: string) => {
  const local = email.split('@')[0] || email;
  return local
    .replace(/[._-]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
    .trim();
};

const buildSupportCaseNote = async (note: {
  id: string;
  content: string;
  isInternal: boolean;
  createdAt: Date;
  admin: { id: string; email: string } | null;
}) => {
  const admin = note.admin;
  return {
    id: note.id,
    content: note.content,
    isInternal: note.isInternal,
    createdAt: note.createdAt.toISOString(),
    author: admin
      ? {
          id: admin.id,
          name: formatAdminNoteAuthorName(admin.email),
          email: admin.email,
          role: 'Admin',
          avatar: buildSupportAvatar(admin.email, admin.id),
        }
      : null,
  } satisfies SupportCaseNoteSummary;
};

const enrichSupportCase = async (supportCase: {
  id: string;
  caseId: string;
  subject: string;
  description: string;
  priority: string;
  status: string;
  category: string;
  userId: string | null;
  userType: ActorType | null;
  assignedToId: string | null;
  createdAt: Date;
  updatedAt: Date;
  assignedTo?: { id: string; email: string; role: AdminRole } | null;
  notes?: Array<{
    id: string;
    content: string;
    isInternal: boolean;
    createdAt: Date;
    admin: { id: string; email: string } | null;
  }>;
}) => {
  const [user, notes] = await Promise.all([
    getSupportUserSummary(supportCase.userType, supportCase.userId),
    Promise.all((supportCase.notes || []).map(buildSupportCaseNote)),
  ]);

  const assignedTo = supportCase.assignedTo
    ? {
        id: supportCase.assignedTo.id,
        name: supportCase.assignedTo.email
          .split('@')[0]
          .replace(/[._-]+/g, ' '),
        email: supportCase.assignedTo.email,
        role: normalizeRoleLabel(ActorType.ADMIN, supportCase.assignedTo.role),
        avatar: buildSupportAvatar(
          supportCase.assignedTo.email,
          supportCase.assignedTo.id,
        ),
      }
    : null;

  return {
    ...supportCase,
    priority: normalizeStoredCasePriority(supportCase.priority),
    user,
    userLabel: user?.name || supportCase.userId || 'Unknown user',
    assignedTo,
    notes,
  };
};

const enrichActivityLog = async (log: {
  id: string;
  action: string;
  actorId: string;
  actorType: ActorType;
  targetId: string | null;
  targetType: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  status: ActionStatus;
  metadata: unknown;
  createdAt: Date;
}): Promise<EnrichedActivityLog> => {
  const metadata =
    log.metadata &&
    typeof log.metadata === 'object' &&
    !Array.isArray(log.metadata)
      ? (log.metadata as Record<string, unknown>)
      : {};

  const actor = await buildActor(log.actorType, log.actorId);

  return {
    id: log.id,
    timestamp: log.createdAt.toISOString(),
    event: humanizeAction(log.action),
    description: describeLog(log.action, metadata),
    status: normalizeStatus(log.status),
    actor,
    meta: {
      ip: log.ipAddress || 'Unknown',
      device: deriveDeviceLabel(log.userAgent),
      location:
        typeof metadata.location === 'string' && metadata.location.trim()
          ? metadata.location
          : 'Unknown',
    },
    action: log.action,
    targetId: log.targetId,
    targetType: log.targetType,
    rawLog: {
      id: log.id,
      action: log.action,
      actorId: log.actorId,
      actorType: log.actorType,
      targetId: log.targetId,
      targetType: log.targetType,
      ipAddress: log.ipAddress,
      userAgent: log.userAgent,
      status: log.status,
      metadata: metadata,
      createdAt: log.createdAt.toISOString(),
    },
  };
};

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

    const enrichedLogs = await Promise.all(
      logs.map((log) => enrichActivityLog(log)),
    );

    res.status(200).json({
      status: 'success',
      results: enrichedLogs.length,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
      data: { logs: enrichedLogs },
    });
  },
);

export const getActivityLogById = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;

    const log = await prisma.activityLog.findUnique({
      where: { id },
    });

    if (!log) {
      return next(new AppError('Activity log not found', 404));
    }

    const enrichedLog = await enrichActivityLog(log);

    res.status(200).json({
      status: 'success',
      data: { log: enrichedLog },
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
    if (priority) {
      const p = String(priority).toUpperCase();
      if (p === 'LOW') {
        where.priority = { in: [CasePriority.LOW, CasePriority.MEDIUM] };
      } else {
        where.priority = priority;
      }
    }
    if (userId) where.userId = userId;

    const [cases, total] = await Promise.all([
      prisma.supportCase.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          assignedTo: { select: { id: true, email: true, role: true } },
        },
      }),
      prisma.supportCase.count({ where }),
    ]);

    const enrichedCases = await Promise.all(cases.map(enrichSupportCase));

    res.status(200).json({
      status: 'success',
      results: enrichedCases.length,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
      data: { cases: enrichedCases },
    });
  },
);

export const createSupportCase = catchAsync(
  async (req: Request, res: Response) => {
    const { subject, description, category, userId, userType } = req.body;

    // Generate a friendly ID (SC-XXXX)
    const count = await prisma.supportCase.count();
    const caseId = `SC-${2000 + count + 1}`;

    const priorityResolved = await deriveAdminSupportCasePriority(
      userType,
      userId,
    );

    const newCase = await prisma.supportCase.create({
      data: {
        caseId,
        subject,
        description,
        category,
        priority: priorityResolved,
        userId,
        userType,
      },
    });

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

export const getCaseById = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;

    const supportCase = await prisma.supportCase.findFirst({
      where: { OR: [{ id }, { caseId: id }] },
      include: {
        assignedTo: { select: { id: true, email: true, role: true } },
        notes: {
          include: { admin: { select: { id: true, email: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!supportCase) {
      return next(new AppError('No case found with that ID', 404));
    }

    const enrichedCase = await enrichSupportCase(supportCase);

    res.status(200).json({
      status: 'success',
      data: { case: enrichedCase },
    });
  },
);

const ALLOWED_CASE_STATUSES = ['OPEN', 'RESOLVED', 'CLOSED'] as const;

export const updateCaseStatus = catchAsync(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const { status, priority, assignedToId } = req.body;

    const supportCase = await prisma.supportCase.findFirst({
      where: { OR: [{ id }, { caseId: id }] },
    });

    if (!supportCase) {
      throw new AppError('No case found with that ID', 404);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = {};
    if (status !== undefined) {
      const normalizedStatus = String(status).toUpperCase();
      if (
        !ALLOWED_CASE_STATUSES.includes(
          normalizedStatus as (typeof ALLOWED_CASE_STATUSES)[number],
        )
      ) {
        throw new AppError(
          'Invalid case status. Allowed values: OPEN, RESOLVED, CLOSED.',
          400,
        );
      }
      data.status = normalizedStatus;
    }
    if (priority !== undefined)
      data.priority = normalizeStoredCasePriority(priority);
    if (assignedToId !== undefined) data.assignedToId = assignedToId;

    const updatedCase = await prisma.supportCase.update({
      where: { id: supportCase.id },
      data,
      include: {
        assignedTo: { select: { id: true, email: true, role: true } },
        notes: {
          include: { admin: { select: { id: true, email: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (status !== undefined) {
      safeNotify('support-case-updated', () =>
        notifySupportCaseEvent({
          caseDbId: supportCase.id,
          event: 'updated',
          previousStatus: supportCase.status,
        }),
      );
    }

    res.status(200).json({
      status: 'success',
      data: { case: await enrichSupportCase(updatedCase) },
    });
  },
);

export const addCaseNote = catchAsync(
  async (req: CustomRequest, res: Response) => {
    const { id } = req.params;
    const { content } = req.body;
    const adminId = req.user?.id; // From adminAuthMiddleware

    if (!adminId) {
      throw new AppError('Admin not authenticated', 401);
    }

    const normalizedContent = String(content || '').trim();
    if (!normalizedContent) {
      throw new AppError('Note content is required', 400);
    }

    const supportCase = await prisma.supportCase.findFirst({
      where: { OR: [{ id }, { caseId: id }] },
      select: { id: true },
    });

    if (!supportCase) {
      throw new AppError('No case found with that ID', 404);
    }

    const note = await prisma.caseNote.create({
      data: {
        caseId: supportCase.id,
        adminId,
        content: normalizedContent,
        // Team-only notes on the admin case view (not shown to the end user in-app)
        isInternal: true,
      },
      include: {
        admin: { select: { id: true, email: true } },
      },
    });

    await prisma.supportCase.update({
      where: { id: supportCase.id },
      data: { updatedAt: new Date() },
    });

    res.status(201).json({
      status: 'success',
      data: { note: await buildSupportCaseNote(note) },
    });
  },
);
