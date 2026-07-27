import { Response, NextFunction } from 'express';
import { prisma } from '../config/prisma.js';
import { catchAsync } from '../utils/catchAsync.js';
import { AppError } from '../utils/AppError.js';
import { CustomRequest } from '../types/index.js';
import {
  ActionStatus,
  ActorType,
  ProfessionalStatus,
  RecruiterStatus,
} from '../generated/client/index.js';
import { logActivity } from '../services/activityLogger.js';
import { getClientIp } from '../utils/requestMetadata.js';
import {
  notifyModerationDecision,
  safeNotify,
} from '../services/eventNotificationService.js';
import {
  isRestrictedStatus,
  recruiterKind,
  resolveProfessionalReinstateStatus,
  resolveRecruiterReinstateStatus,
} from '../services/accountModerationService.js';

/**
 * Admin account moderation: suspend, block (permanent suspension), and reinstate.
 *
 * These endpoints are deliberately separate from the Stage 1 approve/reject flow
 * in adminProfessionalController / adminRecruiterController. Approval decides
 * whether an account may join; moderation decides whether an existing account
 * keeps its access.
 */

type ResolvedAccount =
  | {
      kind: 'professional';
      id: string;
      email: string;
      name: string;
      status: ProfessionalStatus;
      suspendedAt: Date | null;
      suspendedUntil: Date | null;
      suspensionReason: string | null;
      statusBeforeSuspension: ProfessionalStatus | null;
    }
  | {
      kind: 'recruiter' | 'trainer';
      id: string;
      email: string;
      name: string;
      status: RecruiterStatus;
      suspendedAt: Date | null;
      suspendedUntil: Date | null;
      suspensionReason: string | null;
      statusBeforeSuspension: RecruiterStatus | null;
    };

const professionalName = (p: {
  fullname: string | null;
  firstName: string | null;
  lastName: string | null;
}) =>
  p.fullname?.trim() ||
  [p.firstName, p.lastName].filter(Boolean).join(' ') ||
  'Unknown';

const recruiterName = (r: {
  organizationName: string | null;
  firstName: string | null;
  lastName: string | null;
}) =>
  r.organizationName?.trim() ||
  [r.firstName, r.lastName].filter(Boolean).join(' ') ||
  'Unknown';

/**
 * Finds the account by id across both tables. `hint` (accountType query/body
 * param) only reorders the lookup — an id is unique either way.
 */
const resolveAccount = async (
  id: string,
  hint?: string | null,
): Promise<ResolvedAccount | null> => {
  const normalizedHint = String(hint || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

  const loadProfessional = async (): Promise<ResolvedAccount | null> => {
    const p = await prisma.professional.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        fullname: true,
        firstName: true,
        lastName: true,
        status: true,
        suspendedAt: true,
        suspendedUntil: true,
        suspensionReason: true,
        statusBeforeSuspension: true,
      },
    });
    if (!p) return null;
    return {
      kind: 'professional',
      id: p.id,
      email: p.email,
      name: professionalName(p),
      status: p.status,
      suspendedAt: p.suspendedAt,
      suspendedUntil: p.suspendedUntil,
      suspensionReason: p.suspensionReason,
      statusBeforeSuspension: p.statusBeforeSuspension,
    };
  };

  const loadRecruiter = async (): Promise<ResolvedAccount | null> => {
    const r = await prisma.recruiter.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        role: true,
        organizationName: true,
        firstName: true,
        lastName: true,
        status: true,
        suspendedAt: true,
        suspendedUntil: true,
        suspensionReason: true,
        statusBeforeSuspension: true,
      },
    });
    if (!r) return null;
    return {
      kind: recruiterKind(r.role),
      id: r.id,
      email: r.email,
      name: recruiterName(r),
      status: r.status,
      suspendedAt: r.suspendedAt,
      suspendedUntil: r.suspendedUntil,
      suspensionReason: r.suspensionReason,
      statusBeforeSuspension: r.statusBeforeSuspension,
    };
  };

  const order =
    normalizedHint === 'professional'
      ? [loadProfessional, loadRecruiter]
      : normalizedHint === 'recruiter' ||
          normalizedHint === 'trainer' ||
          normalizedHint === 'recruitment_agent' ||
          normalizedHint === 'training_agent'
        ? [loadRecruiter, loadProfessional]
        : [loadProfessional, loadRecruiter];

  for (const load of order) {
    const account = await load();
    if (account) return account;
  }
  return null;
};

const actorTypeFor = (account: ResolvedAccount): ActorType =>
  account.kind === 'professional'
    ? ActorType.PROFESSIONAL
    : ActorType.RECRUITER;

const accountTypeLabel = (account: ResolvedAccount) =>
  account.kind === 'professional'
    ? 'Professional'
    : account.kind === 'trainer'
      ? 'Training Provider'
      : 'Recruiter';

const serialiseModerationState = (account: ResolvedAccount) => ({
  id: account.id,
  accountKind: account.kind,
  accountType: accountTypeLabel(account),
  name: account.name,
  email: account.email,
  status: account.status,
  isRestricted: isRestrictedStatus(account.status),
  suspendedAt: account.suspendedAt,
  suspendedUntil: account.suspendedUntil,
  suspensionReason: account.suspensionReason,
  statusBeforeSuspension: account.statusBeforeSuspension,
});

/** Parses an optional ISO date for a self-lifting suspension. */
const parseSuspendedUntil = (value: unknown): Date | null => {
  if (value === undefined || value === null || value === '') return null;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    throw new AppError('suspendedUntil must be a valid date', 400);
  }
  if (parsed.getTime() <= Date.now()) {
    throw new AppError('suspendedUntil must be in the future', 400);
  }
  return parsed;
};

const requireReason = (value: unknown): string => {
  const reason = String(value || '').trim();
  if (reason.length < 5) {
    return (() => {
      throw new AppError(
        'A reason of at least 5 characters is required for this action',
        400,
      );
    })();
  }
  return reason;
};

/**
 * GET /api/admin/accounts/:id/moderation
 * Current moderation state plus the recorded moderation history for the account.
 */
export const getModerationState = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const account = await resolveAccount(
      req.params.id,
      (req.query.accountType as string) || null,
    );
    if (!account) return next(new AppError('Account not found', 404));

    const [history, reportCount] = await Promise.all([
      prisma.activityLog.findMany({
        where: {
          targetId: account.id,
          action: {
            in: ['ACCOUNT_SUSPENDED', 'ACCOUNT_BLOCKED', 'ACCOUNT_REINSTATED'],
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 25,
      }),
      prisma.userReport.count({ where: { reportedId: account.id } }),
    ]);

    res.status(200).json({
      status: 'success',
      data: {
        moderation: serialiseModerationState(account),
        history,
        reportCount,
      },
    });
  },
);

/**
 * Shared writer for suspend / block. `permanent` maps to the BLOCKED status —
 * a permanent suspension in policy terms.
 */
const applyRestriction = async (
  req: CustomRequest,
  account: ResolvedAccount,
  permanent: boolean,
) => {
  const reason = requireReason(req.body?.reason);
  const suspendedUntil = permanent
    ? null
    : parseSuspendedUntil(req.body?.suspendedUntil);
  const adminId = req.user!.id;

  // Preserve the pre-moderation status once, so a suspend → block → reinstate
  // sequence still restores the account's original standing.
  const statusBeforeSuspension = isRestrictedStatus(account.status)
    ? account.statusBeforeSuspension
    : account.status;

  const data = {
    status: permanent ? 'BLOCKED' : 'SUSPENDED',
    suspendedAt: new Date(),
    suspendedUntil,
    suspensionReason: reason,
    suspendedById: adminId,
    statusBeforeSuspension,
  };

  if (account.kind === 'professional') {
    await prisma.professional.update({
      where: { id: account.id },
      data: {
        ...data,
        status: data.status as ProfessionalStatus,
        statusBeforeSuspension:
          statusBeforeSuspension as ProfessionalStatus | null,
      },
    });
  } else {
    await prisma.recruiter.update({
      where: { id: account.id },
      data: {
        ...data,
        status: data.status as RecruiterStatus,
        statusBeforeSuspension:
          statusBeforeSuspension as RecruiterStatus | null,
      },
    });
  }

  await logActivity({
    action: permanent ? 'ACCOUNT_BLOCKED' : 'ACCOUNT_SUSPENDED',
    actorId: adminId,
    actorType: ActorType.ADMIN,
    targetId: account.id,
    targetType: accountTypeLabel(account),
    status: ActionStatus.WARNING,
    ipAddress: getClientIp(req),
    userAgent: req.get('user-agent'),
    metadata: {
      accountName: account.name,
      accountEmail: account.email,
      reason,
      previousStatus: account.status,
      suspendedUntil: suspendedUntil ? suspendedUntil.toISOString() : null,
    },
  });

  safeNotify('account-moderation', () =>
    notifyModerationDecision({
      userId: account.id,
      userType: actorTypeFor(account),
      decision: permanent ? 'BLOCKED' : 'SUSPENDED',
      reason,
      suspendedUntil,
    }),
  );

  return { reason, suspendedUntil, statusBeforeSuspension };
};

/**
 * POST /api/admin/accounts/:id/suspend
 * Body: { accountType?, reason, suspendedUntil? } — reversible restriction.
 */
export const suspendAccount = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const account = await resolveAccount(
      req.params.id,
      req.body?.accountType || (req.query.accountType as string) || null,
    );
    if (!account) return next(new AppError('Account not found', 404));

    if (account.status === 'SUSPENDED') {
      return next(new AppError('This account is already suspended', 400));
    }

    const { reason, suspendedUntil } = await applyRestriction(
      req,
      account,
      false,
    );

    res.status(200).json({
      status: 'success',
      message: `${accountTypeLabel(account)} account suspended`,
      data: {
        moderation: {
          ...serialiseModerationState(account),
          status: 'SUSPENDED',
          isRestricted: true,
          suspendedAt: new Date(),
          suspendedUntil,
          suspensionReason: reason,
        },
      },
    });
  },
);

/**
 * POST /api/admin/accounts/:id/block
 * Body: { accountType?, reason } — permanent suspension for severe cases.
 */
export const blockAccount = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const account = await resolveAccount(
      req.params.id,
      req.body?.accountType || (req.query.accountType as string) || null,
    );
    if (!account) return next(new AppError('Account not found', 404));

    if (account.status === 'BLOCKED') {
      return next(new AppError('This account is already blocked', 400));
    }

    const { reason } = await applyRestriction(req, account, true);

    res.status(200).json({
      status: 'success',
      message: `${accountTypeLabel(account)} account blocked`,
      data: {
        moderation: {
          ...serialiseModerationState(account),
          status: 'BLOCKED',
          isRestricted: true,
          suspendedAt: new Date(),
          suspendedUntil: null,
          suspensionReason: reason,
        },
      },
    });
  },
);

/**
 * POST /api/admin/accounts/:id/reinstate
 * Body: { accountType?, note? } — restores the status held before moderation.
 */
export const reinstateAccount = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const account = await resolveAccount(
      req.params.id,
      req.body?.accountType || (req.query.accountType as string) || null,
    );
    if (!account) return next(new AppError('Account not found', 404));

    if (!isRestrictedStatus(account.status)) {
      return next(
        new AppError('This account is not suspended or blocked', 400),
      );
    }

    const note = String(req.body?.note || '').trim() || null;
    const adminId = req.user!.id;

    const clearedFields = {
      suspendedAt: null,
      suspendedUntil: null,
      suspensionReason: null,
      suspendedById: null,
      statusBeforeSuspension: null,
    };

    let restoredStatus: string;
    if (account.kind === 'professional') {
      restoredStatus = resolveProfessionalReinstateStatus(
        account.statusBeforeSuspension as ProfessionalStatus | null,
      );
      await prisma.professional.update({
        where: { id: account.id },
        data: {
          ...clearedFields,
          status: restoredStatus as ProfessionalStatus,
        },
      });
    } else {
      restoredStatus = resolveRecruiterReinstateStatus(
        account.statusBeforeSuspension as RecruiterStatus | null,
      );
      await prisma.recruiter.update({
        where: { id: account.id },
        data: {
          ...clearedFields,
          status: restoredStatus as RecruiterStatus,
        },
      });
    }

    await logActivity({
      action: 'ACCOUNT_REINSTATED',
      actorId: adminId,
      actorType: ActorType.ADMIN,
      targetId: account.id,
      targetType: accountTypeLabel(account),
      status: ActionStatus.SUCCESS,
      ipAddress: getClientIp(req),
      userAgent: req.get('user-agent'),
      metadata: {
        accountName: account.name,
        accountEmail: account.email,
        previousStatus: account.status,
        restoredStatus,
        note,
      },
    });

    safeNotify('account-moderation', () =>
      notifyModerationDecision({
        userId: account.id,
        userType: actorTypeFor(account),
        decision: 'REINSTATED',
      }),
    );

    res.status(200).json({
      status: 'success',
      message: `${accountTypeLabel(account)} account reinstated`,
      data: {
        moderation: {
          ...serialiseModerationState(account),
          status: restoredStatus,
          isRestricted: false,
          suspendedAt: null,
          suspendedUntil: null,
          suspensionReason: null,
          statusBeforeSuspension: null,
        },
      },
    });
  },
);

/**
 * GET /api/admin/accounts/moderated
 * Every currently suspended or blocked account, for the admin moderation queue.
 */
export const getModeratedAccounts = catchAsync(
  async (req: CustomRequest, res: Response) => {
    const statusFilter = String(req.query.status || '').toUpperCase();
    const statuses = ['SUSPENDED', 'BLOCKED'].filter(
      (s) => !statusFilter || statusFilter === 'ALL' || s === statusFilter,
    );

    const [professionals, recruiters] = await Promise.all([
      prisma.professional.findMany({
        where: { status: { in: statuses as ProfessionalStatus[] } },
        select: {
          id: true,
          email: true,
          fullname: true,
          firstName: true,
          lastName: true,
          status: true,
          suspendedAt: true,
          suspendedUntil: true,
          suspensionReason: true,
        },
        orderBy: { suspendedAt: 'desc' },
      }),
      prisma.recruiter.findMany({
        where: { status: { in: statuses as RecruiterStatus[] } },
        select: {
          id: true,
          email: true,
          role: true,
          organizationName: true,
          firstName: true,
          lastName: true,
          status: true,
          suspendedAt: true,
          suspendedUntil: true,
          suspensionReason: true,
        },
        orderBy: { suspendedAt: 'desc' },
      }),
    ]);

    const accounts = [
      ...professionals.map((p) => ({
        id: p.id,
        accountName: professionalName(p),
        accountType: 'Professional',
        accountKind: 'professional',
        email: p.email,
        status: p.status,
        suspendedAt: p.suspendedAt,
        suspendedUntil: p.suspendedUntil,
        reason: p.suspensionReason,
      })),
      ...recruiters.map((r) => ({
        id: r.id,
        accountName: recruiterName(r),
        accountType:
          r.role === 'TRAINING_AGENT' ? 'Training Provider' : 'Recruiter',
        accountKind: recruiterKind(r.role),
        email: r.email,
        status: r.status,
        suspendedAt: r.suspendedAt,
        suspendedUntil: r.suspendedUntil,
        reason: r.suspensionReason,
      })),
    ].sort(
      (a, b) =>
        new Date(b.suspendedAt || 0).getTime() -
        new Date(a.suspendedAt || 0).getTime(),
    );

    res.status(200).json({
      status: 'success',
      results: accounts.length,
      data: { accounts },
    });
  },
);
