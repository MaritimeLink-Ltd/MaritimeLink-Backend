import type { Server as SocketServer } from 'socket.io';
import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import { sendKycStatusEmail } from './emailService.js';

export type KycAudience = 'PROFESSIONAL' | 'RECRUITER';
export type KycDecisionStatus = 'APPROVED' | 'REJECTED';

type NotifyKycStatusChangeParams = {
  audience: KycAudience;
  userId: string;
  status: KycDecisionStatus;
  rejectionReason?: string;
  io?: SocketServer;
};

function displayName(
  parts: {
    fullname?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    organizationName?: string | null;
  },
  fallback = 'there',
): string {
  const fromParts = [parts.firstName, parts.lastName].filter(Boolean).join(' ');
  return (
    parts.fullname?.trim() ||
    parts.organizationName?.trim() ||
    fromParts ||
    fallback
  );
}

function dashboardUrl(
  audience: KycAudience,
  recruiterRole?: string | null,
): string {
  const base = env.FRONTEND_URL.replace(/\/+$/, '');
  if (audience === 'PROFESSIONAL') {
    return `${base}/personal/dashboard`;
  }
  if (recruiterRole === 'TRAINING_AGENT') {
    return `${base}/trainingprovider-dashboard`;
  }
  return `${base}/recruiter-dashboard`;
}

function accountLabel(
  audience: KycAudience,
  recruiterRole?: string | null,
): string {
  if (audience === 'PROFESSIONAL') return 'Professional';
  if (recruiterRole === 'TRAINING_AGENT') return 'Training Provider';
  return 'Recruiter';
}

function alertCopy(status: KycDecisionStatus, rejectionReason?: string) {
  if (status === 'APPROVED') {
    return {
      title: 'KYC verification approved',
      message:
        'Your identity verification has been approved. You now have full access to platform features.',
    };
  }
  const reason = rejectionReason?.trim();
  return {
    title: 'KYC verification not approved',
    message: reason
      ? `Your identity verification was not approved. Reason: ${reason}`
      : 'Your identity verification was not approved. Please review your submission and try again, or contact support if you need help.',
  };
}

/**
 * In-app alert (professionals) + email when KYC is approved or rejected.
 * Errors are logged; callers are not failed if notification delivery fails.
 */
export async function notifyKycStatusChange(
  params: NotifyKycStatusChangeParams,
): Promise<void> {
  const { audience, userId, status, rejectionReason, io } = params;

  try {
    if (audience === 'PROFESSIONAL') {
      const professional = await prisma.professional.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          fullname: true,
          firstName: true,
          lastName: true,
        },
      });
      if (!professional?.email) {
        console.warn(
          `[KYC notify] Professional ${userId} not found or missing email`,
        );
        return;
      }

      const name = displayName(professional);
      const label = accountLabel('PROFESSIONAL');
      const { title, message } = alertCopy(status, rejectionReason);

      const alert = await prisma.alert.create({
        data: {
          professionalId: professional.id,
          type: 'KYC_STATUS',
          title,
          message,
          metadata: {
            status,
            ...(rejectionReason ? { rejectionReason } : {}),
          },
        },
      });

      if (io) {
        io.to(professional.id).emit('professional_alert', { alert });
      }

      await sendKycStatusEmail({
        to: professional.email,
        recipientName: name,
        accountLabel: label,
        status,
        dashboardUrl: dashboardUrl('PROFESSIONAL'),
        rejectionReason,
      });
      return;
    }

    const recruiter = await prisma.recruiter.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        firstName: true,
        lastName: true,
        organizationName: true,
      },
    });
    if (!recruiter?.email) {
      console.warn(
        `[KYC notify] Recruiter ${userId} not found or missing email`,
      );
      return;
    }

    const name = displayName(recruiter);
    const label = accountLabel('RECRUITER', recruiter.role);

    await sendKycStatusEmail({
      to: recruiter.email,
      recipientName: name,
      accountLabel: label,
      status,
      dashboardUrl: dashboardUrl('RECRUITER', recruiter.role),
      rejectionReason,
    });
  } catch (error) {
    console.error('[KYC notify] Failed to send KYC notifications:', error);
  }
}
