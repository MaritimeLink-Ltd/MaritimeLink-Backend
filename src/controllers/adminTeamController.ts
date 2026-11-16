import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';
import { catchAsync } from '../utils/catchAsync.js';
import { CustomRequest } from '../types/index.js';
import { sendAdminInvitationEmail } from '../services/emailService.js';
import { logActivity } from '../services/activityLogger.js';
import {
  ActionStatus,
  ActorType,
  AdminRole,
} from '../generated/client/index.js';
import { getClientIp } from '../utils/requestMetadata.js';
import {
  INVITABLE_ADMIN_ROLES,
  adminRoleLabel,
  canManageAdminTeam,
  canViewFinancials,
} from '../config/adminRoles.js';

/**
 * Admin team management (super admins only), plus the public invitation
 * acceptance endpoints.
 *
 * Invitations: a random 256-bit token is emailed; only its SHA-256 hash is
 * stored. The link expires after INVITE_TTL_HOURS, works once, and a newer
 * invitation (or resend) for the same email replaces the older one. The admin
 * account is only created when the invitee accepts and sets a password.
 *
 * Removing someone sets `disabledAt` instead of deleting the row, because jobs,
 * courses and support threads reference admins. A deactivated admin can't sign
 * in or use any admin endpoint and can be reactivated later.
 */

const INVITE_TTL_HOURS = 72;

const hashToken = (token: string) =>
  crypto.createHash('sha256').update(token).digest('hex');

const normalizeEmail = (email: string) => email.trim().toLowerCase();

const inviteSchema = z.object({
  email: z.string().trim().email('Please enter a valid email address'),
  role: z.enum(INVITABLE_ADMIN_ROLES, {
    message: 'Please choose a role: Super Admin or Operations Manager',
  }),
});

const roleChangeSchema = z.object({
  role: z.enum(INVITABLE_ADMIN_ROLES, {
    message: 'Please choose a role: Super Admin or Operations Manager',
  }),
});

const acceptSchema = z.object({
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password is too long')
    .refine(
      (value) => /[A-Za-z]/.test(value) && /\d/.test(value),
      'Password must include at least one letter and one number',
    ),
  name: z.string().trim().max(80).optional(),
});

type InvitationStatus = 'PENDING' | 'EXPIRED' | 'ACCEPTED' | 'REVOKED';

const invitationStatus = (invite: {
  acceptedAt: Date | null;
  revokedAt: Date | null;
  expiresAt: Date;
}): InvitationStatus => {
  if (invite.acceptedAt) return 'ACCEPTED';
  if (invite.revokedAt) return 'REVOKED';
  if (invite.expiresAt.getTime() <= Date.now()) return 'EXPIRED';
  return 'PENDING';
};

const displayNameOf = (accountSettings: unknown): string | null => {
  if (
    accountSettings &&
    typeof accountSettings === 'object' &&
    !Array.isArray(accountSettings)
  ) {
    const profile = (accountSettings as Record<string, unknown>).profile;
    if (profile && typeof profile === 'object' && !Array.isArray(profile)) {
      const name = (profile as Record<string, unknown>).displayName;
      if (typeof name === 'string' && name.trim()) return name.trim();
    }
  }
  return null;
};

const acceptUrlFor = (token: string) =>
  `${env.FRONTEND_URL.replace(/\/+$/, '')}/admin/accept-invite/${token}`;

const countActiveSuperAdmins = () =>
  prisma.admin.count({
    where: { role: AdminRole.SUPER_ADMIN, disabledAt: null },
  });

/** GET /api/admin/team — members and open invitations. */
export const getTeam = catchAsync(async (req: CustomRequest, res: Response) => {
  const [admins, invitations] = await Promise.all([
    prisma.admin.findMany({
      select: {
        id: true,
        email: true,
        role: true,
        accountSettings: true,
        createdAt: true,
        lastLoginAt: true,
        disabledAt: true,
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.adminInvitation.findMany({
      where: { acceptedAt: null, revokedAt: null },
      select: {
        id: true,
        email: true,
        role: true,
        expiresAt: true,
        acceptedAt: true,
        revokedAt: true,
        createdAt: true,
        invitedBy: { select: { email: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  res.status(200).json({
    status: 'success',
    data: {
      members: admins.map((admin) => ({
        id: admin.id,
        email: admin.email,
        name: displayNameOf(admin.accountSettings),
        role: admin.role,
        roleLabel: adminRoleLabel(admin.role),
        status: admin.disabledAt ? 'DEACTIVATED' : 'ACTIVE',
        createdAt: admin.createdAt,
        lastLoginAt: admin.lastLoginAt,
        disabledAt: admin.disabledAt,
        isYou: admin.id === req.user?.id,
      })),
      invitations: invitations.map((invite) => ({
        id: invite.id,
        email: invite.email,
        role: invite.role,
        roleLabel: adminRoleLabel(invite.role),
        status: invitationStatus(invite),
        expiresAt: invite.expiresAt,
        createdAt: invite.createdAt,
        invitedBy: invite.invitedBy?.email ?? null,
      })),
      invitableRoles: INVITABLE_ADMIN_ROLES.map((role) => ({
        value: role,
        label: adminRoleLabel(role),
      })),
    },
  });
});

/**
 * Creates (or replaces) the invitation for `email` and emails the link.
 * Returns the invitation row.
 */
const issueInvitation = async (
  req: CustomRequest,
  email: string,
  role: (typeof INVITABLE_ADMIN_ROLES)[number],
) => {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + INVITE_TTL_HOURS * 60 * 60 * 1000);

  const invitation = await prisma.$transaction(async (tx) => {
    // Only the newest invitation for an email can be used.
    await tx.adminInvitation.updateMany({
      where: { email, acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return tx.adminInvitation.create({
      data: {
        email,
        role,
        tokenHash: hashToken(token),
        invitedById: req.user!.id,
        expiresAt,
      },
    });
  });

  try {
    await sendAdminInvitationEmail({
      to: email,
      inviterEmail: req.user?.email ?? 'A MaritimeLink super admin',
      roleLabel: adminRoleLabel(role),
      acceptUrl: acceptUrlFor(token),
      expiresInHours: INVITE_TTL_HOURS,
    });
  } catch (error) {
    // Don't leave a usable invitation behind if the email never went out.
    await prisma.adminInvitation.update({
      where: { id: invitation.id },
      data: { revokedAt: new Date() },
    });
    console.error('Admin invitation email failed:', (error as Error)?.message);
    throw new AppError(
      'The invitation email could not be sent. Please try again.',
      502,
    );
  }

  await logActivity({
    action: 'ADMIN_INVITED',
    actorId: req.user!.id,
    actorType: ActorType.ADMIN,
    status: ActionStatus.SUCCESS,
    ipAddress: getClientIp(req),
    userAgent: req.get('user-agent') || undefined,
    metadata: { email, role },
  });

  return invitation;
};

/** POST /api/admin/team/invitations — { email, role } */
export const inviteTeamMember = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const parsed = inviteSchema.parse(req.body);
    const email = normalizeEmail(parsed.email);

    const existing = await prisma.admin.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      select: { disabledAt: true },
    });
    if (existing && !existing.disabledAt) {
      return next(
        new AppError('This person is already a member of the admin team.', 409),
      );
    }

    const invitation = await issueInvitation(req, email, parsed.role);

    res.status(201).json({
      status: 'success',
      message: `Invitation sent to ${email}.`,
      data: {
        invitation: {
          id: invitation.id,
          email: invitation.email,
          role: invitation.role,
          roleLabel: adminRoleLabel(invitation.role),
          status: invitationStatus(invitation),
          expiresAt: invitation.expiresAt,
          createdAt: invitation.createdAt,
        },
      },
    });
  },
);

/** POST /api/admin/team/invitations/:id/resend — new link, new expiry. */
export const resendInvitation = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const invite = await prisma.adminInvitation.findUnique({
      where: { id: req.params.id },
    });
    if (!invite || invite.acceptedAt || invite.revokedAt) {
      return next(new AppError('Invitation not found', 404));
    }

    const role = (INVITABLE_ADMIN_ROLES as readonly string[]).includes(
      invite.role,
    )
      ? (invite.role as (typeof INVITABLE_ADMIN_ROLES)[number])
      : 'OPERATIONS_MANAGER';
    const invitation = await issueInvitation(req, invite.email, role);

    res.status(200).json({
      status: 'success',
      message: `Invitation re-sent to ${invitation.email}.`,
      data: {
        invitation: {
          id: invitation.id,
          email: invitation.email,
          role: invitation.role,
          roleLabel: adminRoleLabel(invitation.role),
          status: invitationStatus(invitation),
          expiresAt: invitation.expiresAt,
          createdAt: invitation.createdAt,
        },
      },
    });
  },
);

/** DELETE /api/admin/team/invitations/:id — cancel a pending invitation. */
export const revokeInvitation = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const result = await prisma.adminInvitation.updateMany({
      where: { id: req.params.id, acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (result.count === 0) {
      return next(new AppError('Invitation not found', 404));
    }
    res.status(200).json({
      status: 'success',
      message: 'Invitation cancelled.',
    });
  },
);

/** PATCH /api/admin/team/members/:id — { role } */
export const changeMemberRole = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const { role } = roleChangeSchema.parse(req.body);
    const memberId = req.params.id;

    if (memberId === req.user?.id) {
      return next(new AppError('You cannot change your own role.', 400));
    }

    const member = await prisma.admin.findUnique({ where: { id: memberId } });
    if (!member) return next(new AppError('Team member not found', 404));

    if (
      member.role === AdminRole.SUPER_ADMIN &&
      role !== AdminRole.SUPER_ADMIN &&
      !member.disabledAt &&
      (await countActiveSuperAdmins()) <= 1
    ) {
      return next(
        new AppError('The platform must keep at least one super admin.', 400),
      );
    }

    const updated = await prisma.admin.update({
      where: { id: memberId },
      data: { role },
      select: { id: true, email: true, role: true },
    });

    await logActivity({
      action: 'ADMIN_ROLE_CHANGED',
      actorId: req.user!.id,
      actorType: ActorType.ADMIN,
      status: ActionStatus.SUCCESS,
      targetId: memberId,
      targetType: 'Admin',
      ipAddress: getClientIp(req),
      userAgent: req.get('user-agent') || undefined,
      metadata: { email: updated.email, from: member.role, to: role },
    });

    res.status(200).json({
      status: 'success',
      message: 'Role updated.',
      data: {
        member: { ...updated, roleLabel: adminRoleLabel(updated.role) },
      },
    });
  },
);

const setMemberDisabled = (disable: boolean) =>
  catchAsync(async (req: CustomRequest, res: Response, next: NextFunction) => {
    const memberId = req.params.id;

    if (disable && memberId === req.user?.id) {
      return next(new AppError('You cannot deactivate your own account.', 400));
    }

    const member = await prisma.admin.findUnique({ where: { id: memberId } });
    if (!member) return next(new AppError('Team member not found', 404));

    if (
      disable &&
      member.role === AdminRole.SUPER_ADMIN &&
      !member.disabledAt &&
      (await countActiveSuperAdmins()) <= 1
    ) {
      return next(
        new AppError('The platform must keep at least one super admin.', 400),
      );
    }

    const updated = await prisma.admin.update({
      where: { id: memberId },
      data: { disabledAt: disable ? new Date() : null },
      select: { id: true, email: true, role: true, disabledAt: true },
    });

    await logActivity({
      action: disable ? 'ADMIN_DEACTIVATED' : 'ADMIN_REACTIVATED',
      actorId: req.user!.id,
      actorType: ActorType.ADMIN,
      status: ActionStatus.SUCCESS,
      targetId: memberId,
      targetType: 'Admin',
      ipAddress: getClientIp(req),
      userAgent: req.get('user-agent') || undefined,
      metadata: { email: updated.email },
    });

    res.status(200).json({
      status: 'success',
      message: disable
        ? 'Team member deactivated.'
        : 'Team member reactivated.',
      data: {
        member: {
          ...updated,
          roleLabel: adminRoleLabel(updated.role),
          status: updated.disabledAt ? 'DEACTIVATED' : 'ACTIVE',
        },
      },
    });
  });

/** POST /api/admin/team/members/:id/deactivate */
export const deactivateMember = setMemberDisabled(true);
/** POST /api/admin/team/members/:id/reactivate */
export const reactivateMember = setMemberDisabled(false);

/** Finds a usable invitation by its raw token, or explains why not. */
const findUsableInvitation = async (token: string) => {
  if (!/^[a-f0-9]{64}$/i.test(token || ''))
    return { error: 'INVALID' as const };
  const invite = await prisma.adminInvitation.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { invitedBy: { select: { email: true } } },
  });
  if (!invite) return { error: 'INVALID' as const };
  const status = invitationStatus(invite);
  if (status !== 'PENDING') return { error: status };
  return { invite };
};

const invitationErrorMessage = (error: string) =>
  error === 'EXPIRED'
    ? 'This invitation has expired. Ask a super admin to send you a new one.'
    : error === 'ACCEPTED'
      ? 'This invitation has already been used. Please sign in instead.'
      : 'This invitation link is not valid. Ask a super admin to send you a new one.';

/** GET /api/admin/invitations/:token — public; details for the accept page. */
export const getInvitation = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const result = await findUsableInvitation(String(req.params.token ?? ''));
    if (!result.invite) {
      const reason = result.error ?? 'INVALID';
      return next(
        new AppError(
          invitationErrorMessage(reason),
          410,
          `INVITATION_${reason}`,
        ),
      );
    }
    const { invite } = result;
    res.status(200).json({
      status: 'success',
      data: {
        invitation: {
          email: invite.email,
          role: invite.role,
          roleLabel: adminRoleLabel(invite.role),
          expiresAt: invite.expiresAt,
          invitedBy: invite.invitedBy?.email ?? null,
        },
      },
    });
  },
);

/**
 * POST /api/admin/invitations/:token/accept — public; { password, name? }.
 * Creates the admin account (or restores a deactivated one with this email)
 * and signs the person in.
 */
export const acceptInvitation = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const { password, name } = acceptSchema.parse(req.body);
    const result = await findUsableInvitation(String(req.params.token ?? ''));
    if (!result.invite) {
      const reason = result.error ?? 'INVALID';
      return next(
        new AppError(
          invitationErrorMessage(reason),
          410,
          `INVITATION_${reason}`,
        ),
      );
    }
    const { invite } = result;
    const hashedPassword = await bcrypt.hash(password, 12);

    const admin = await prisma.$transaction(async (tx) => {
      // Claim the invitation first so it can only ever be used once.
      const claimed = await tx.adminInvitation.updateMany({
        where: { id: invite.id, acceptedAt: null, revokedAt: null },
        data: { acceptedAt: new Date() },
      });
      if (claimed.count !== 1) {
        throw new AppError(invitationErrorMessage('ACCEPTED'), 410);
      }

      const existing = await tx.admin.findFirst({
        where: { email: { equals: invite.email, mode: 'insensitive' } },
      });
      if (existing && !existing.disabledAt) {
        throw new AppError(
          'This email already has an admin account. Please sign in instead.',
          409,
        );
      }

      if (existing) {
        // Returning member: keep their other saved settings, only set the name.
        const settings =
          (existing.accountSettings as Record<string, unknown> | null) ?? {};
        const savedProfile =
          (settings.profile as Record<string, unknown> | undefined) ?? {};
        return tx.admin.update({
          where: { id: existing.id },
          data: {
            password: hashedPassword,
            role: invite.role,
            disabledAt: null,
            passwordResetToken: null,
            passwordResetExpires: null,
            lastLoginAt: new Date(),
            ...(name && {
              accountSettings: {
                ...settings,
                profile: { ...savedProfile, displayName: name },
              },
            }),
          },
        });
      }

      return tx.admin.create({
        data: {
          email: invite.email,
          password: hashedPassword,
          role: invite.role,
          lastLoginAt: new Date(),
          ...(name && { accountSettings: { profile: { displayName: name } } }),
        },
      });
    });

    await logActivity({
      action: 'ADMIN_INVITATION_ACCEPTED',
      actorId: admin.id,
      actorType: ActorType.ADMIN,
      status: ActionStatus.SUCCESS,
      ipAddress: getClientIp(req),
      userAgent: req.get('user-agent') || undefined,
      metadata: { email: admin.email, role: admin.role },
    });

    const token = jwt.sign({ id: admin.id, role: admin.role }, env.JWT_SECRET, {
      expiresIn: '7d',
    });

    res.status(201).json({
      status: 'success',
      message: 'Welcome to the MaritimeLink admin team.',
      token,
      data: {
        user: {
          id: admin.id,
          email: admin.email,
          role: admin.role,
          roleLabel: adminRoleLabel(admin.role),
          name: name || null,
          permissions: {
            canManageTeam: canManageAdminTeam(admin.role),
            canViewFinancials: canViewFinancials(admin.role),
          },
        },
      },
    });
  },
);
