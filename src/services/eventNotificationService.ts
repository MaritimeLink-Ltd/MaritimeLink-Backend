import type { Server as SocketServer } from 'socket.io';
import { prisma } from '../config/prisma.js';
import { ActorType, ApplicationStatus } from '../generated/client/index.js';
import {
  sendAccountStatusEmail,
  sendApplicationStatusEmail,
  sendCourseBookingEmails,
  sendJobApplicationEmails,
  sendJobInvitationEmail,
  sendKycResubmissionEmail,
  sendKycStatusEmail,
  sendKycSubmittedEmail,
  sendMessageReceivedEmail,
  sendPaymentStatusEmail,
  sendSupportCaseEmail,
} from './emailService.js';
import { appUrl } from './emailLayout.js';

export type KycAudience = 'PROFESSIONAL' | 'RECRUITER';
export type KycDecisionStatus = 'APPROVED' | 'REJECTED';

type UserNameFields = {
  fullname?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  organizationName?: string | null;
};

export function displayName(parts: UserNameFields, fallback = 'there'): string {
  const fromParts = [parts.firstName, parts.lastName].filter(Boolean).join(' ');
  return (
    parts.fullname?.trim() ||
    parts.organizationName?.trim() ||
    fromParts ||
    fallback
  );
}

export function dashboardUrl(
  audience: KycAudience | 'RECRUITER_ACCOUNT',
  recruiterRole?: string | null,
): string {
  if (audience === 'PROFESSIONAL') {
    return appUrl('/personal/dashboard');
  }
  if (recruiterRole === 'TRAINING_AGENT') {
    return appUrl('/trainingprovider-dashboard');
  }
  return appUrl('/recruiter-dashboard');
}

function accountLabel(
  audience: KycAudience,
  recruiterRole?: string | null,
): string {
  if (audience === 'PROFESSIONAL') return 'Professional';
  if (recruiterRole === 'TRAINING_AGENT') return 'Training Provider';
  return 'Recruiter';
}

function logNotifyError(event: string, error: unknown) {
  console.error(`[notify:${event}]`, error);
}

export function safeNotify(event: string, fn: () => Promise<void>): void {
  void fn().catch((error) => logNotifyError(event, error));
}

async function resolveUserEmail(
  userId: string,
  userType: ActorType,
): Promise<{
  email: string;
  name: string;
  recruiterRole?: string | null;
} | null> {
  if (userType === ActorType.PROFESSIONAL) {
    const p = await prisma.professional.findUnique({
      where: { id: userId },
      select: {
        email: true,
        fullname: true,
        firstName: true,
        lastName: true,
      },
    });
    if (!p?.email) return null;
    return { email: p.email, name: displayName(p) };
  }

  const r = await prisma.recruiter.findUnique({
    where: { id: userId },
    select: {
      email: true,
      role: true,
      firstName: true,
      lastName: true,
      organizationName: true,
    },
  });
  if (!r?.email) return null;
  return {
    email: r.email,
    name: displayName(r),
    recruiterRole: r.role,
  };
}

export async function notifyKycStatusChange(params: {
  audience: KycAudience;
  userId: string;
  status: KycDecisionStatus;
  rejectionReason?: string;
  io?: SocketServer;
}): Promise<void> {
  const { audience, userId, status, rejectionReason, io } = params;

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
    if (!professional?.email) return;

    const name = displayName(professional);
    const title =
      status === 'APPROVED'
        ? 'KYC verification approved'
        : 'KYC verification not approved';
    const message =
      status === 'APPROVED'
        ? 'Your identity verification has been approved. You now have full access to platform features.'
        : rejectionReason?.trim()
          ? `Your identity verification was not approved. Reason: ${rejectionReason.trim()}`
          : 'Your identity verification was not approved. Please review your submission and try again.';

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
      accountLabel: accountLabel('PROFESSIONAL'),
      status,
      dashboardUrl: dashboardUrl('PROFESSIONAL'),
      rejectionReason,
    });
    return;
  }

  const recruiter = await prisma.recruiter.findUnique({
    where: { id: userId },
    select: {
      email: true,
      role: true,
      firstName: true,
      lastName: true,
      organizationName: true,
    },
  });
  if (!recruiter?.email) return;

  await sendKycStatusEmail({
    to: recruiter.email,
    recipientName: displayName(recruiter),
    accountLabel: accountLabel('RECRUITER', recruiter.role),
    status,
    dashboardUrl: dashboardUrl('RECRUITER', recruiter.role),
    rejectionReason,
  });
}

export async function notifyKycSubmitted(params: {
  audience: KycAudience;
  userId: string;
}): Promise<void> {
  const { audience, userId } = params;

  if (audience === 'PROFESSIONAL') {
    const p = await prisma.professional.findUnique({
      where: { id: userId },
      select: { email: true, fullname: true, firstName: true, lastName: true },
    });
    if (!p?.email) return;
    await sendKycSubmittedEmail({
      to: p.email,
      recipientName: displayName(p),
      accountLabel: 'Professional',
      dashboardUrl: dashboardUrl('PROFESSIONAL'),
    });
    return;
  }

  const r = await prisma.recruiter.findUnique({
    where: { id: userId },
    select: {
      email: true,
      role: true,
      firstName: true,
      lastName: true,
      organizationName: true,
    },
  });
  if (!r?.email) return;
  await sendKycSubmittedEmail({
    to: r.email,
    recipientName: displayName(r),
    accountLabel: accountLabel('RECRUITER', r.role),
    dashboardUrl: dashboardUrl('RECRUITER', r.role),
  });
}

export async function notifyKycResubmissionRequested(params: {
  audience: KycAudience;
  userId: string;
  notes?: string;
}): Promise<void> {
  const { audience, userId, notes } = params;

  if (audience === 'PROFESSIONAL') {
    const p = await prisma.professional.findUnique({
      where: { id: userId },
      select: { email: true, fullname: true, firstName: true, lastName: true },
    });
    if (!p?.email) return;
    await sendKycResubmissionEmail({
      to: p.email,
      recipientName: displayName(p),
      accountLabel: 'Professional',
      notes,
      dashboardUrl: appUrl('/personal/profile'),
    });
    return;
  }

  const r = await prisma.recruiter.findUnique({
    where: { id: userId },
    select: {
      email: true,
      role: true,
      firstName: true,
      lastName: true,
      organizationName: true,
    },
  });
  if (!r?.email) return;
  await sendKycResubmissionEmail({
    to: r.email,
    recipientName: displayName(r),
    accountLabel: accountLabel('RECRUITER', r.role),
    notes,
    dashboardUrl: dashboardUrl('RECRUITER', r.role),
  });
}

export async function notifyAccountStage1Decision(params: {
  recruiterId: string;
  status: 'APPROVED' | 'REJECTED';
  rejectionReason?: string;
}): Promise<void> {
  const recruiter = await prisma.recruiter.findUnique({
    where: { id: params.recruiterId },
    select: {
      email: true,
      role: true,
      firstName: true,
      lastName: true,
      organizationName: true,
    },
  });
  if (!recruiter?.email) return;

  await sendAccountStatusEmail({
    to: recruiter.email,
    recipientName: displayName(recruiter),
    accountLabel: accountLabel('RECRUITER', recruiter.role),
    approved: params.status === 'APPROVED',
    rejectionReason: params.rejectionReason,
    dashboardUrl: dashboardUrl('RECRUITER', recruiter.role),
  });
}

export async function notifyJobApplicationSubmitted(
  applicationId: string,
): Promise<void> {
  const application = await prisma.jobApplication.findUnique({
    where: { id: applicationId },
    include: {
      job: {
        select: {
          id: true,
          title: true,
          recruiterId: true,
          recruiter: {
            select: {
              email: true,
              organizationName: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      },
      professional: {
        select: {
          id: true,
          email: true,
          fullname: true,
          firstName: true,
          lastName: true,
        },
      },
    },
  });
  if (!application?.professional?.email || !application.job) return;

  const proName = displayName(application.professional);
  const jobTitle = application.job.title;

  await sendJobApplicationEmails({
    professional: {
      to: application.professional.email,
      name: proName,
      jobTitle,
      dashboardUrl: appUrl(`/personal/jobs/${application.job.id}`),
    },
    recruiter: application.job.recruiter?.email
      ? {
          to: application.job.recruiter.email,
          name: displayName(application.job.recruiter),
          jobTitle,
          applicantName: proName,
          dashboardUrl: appUrl(`/recruiter/jobs/${application.job.id}`),
        }
      : undefined,
  });
}

export async function notifyJobInvitation(params: {
  professionalId: string;
  jobId: string;
  jobTitle: string;
  senderName: string;
}): Promise<void> {
  const professional = await prisma.professional.findUnique({
    where: { id: params.professionalId },
    select: { email: true, fullname: true, firstName: true, lastName: true },
  });
  if (!professional?.email) return;

  await sendJobInvitationEmail({
    to: professional.email,
    recipientName: displayName(professional),
    jobTitle: params.jobTitle,
    senderName: params.senderName,
    jobUrl: appUrl(`/personal/jobs/${params.jobId}`),
  });
}

export async function notifyApplicationStatusChanged(params: {
  professionalId: string;
  jobTitle: string;
  status: ApplicationStatus;
  rejectionReason?: string | null;
  io?: SocketServer;
}): Promise<void> {
  const professional = await prisma.professional.findUnique({
    where: { id: params.professionalId },
    select: { email: true, fullname: true, firstName: true, lastName: true },
  });
  if (!professional?.email) return;

  await sendApplicationStatusEmail({
    to: professional.email,
    recipientName: displayName(professional),
    jobTitle: params.jobTitle,
    status: params.status,
    rejectionReason: params.rejectionReason,
    dashboardUrl: appUrl('/personal/my-jobs'),
  });
}

export async function notifyMessageReceived(params: {
  conversationId: string;
  senderId: string;
  senderType: 'PROFESSIONAL' | 'RECRUITER' | 'ADMIN';
}): Promise<void> {
  const conversation = await prisma.conversation.findUnique({
    where: { id: params.conversationId },
    include: {
      professional: {
        select: {
          id: true,
          email: true,
          fullname: true,
          firstName: true,
          lastName: true,
        },
      },
      recruiter: {
        select: {
          id: true,
          email: true,
          role: true,
          organizationName: true,
          firstName: true,
          lastName: true,
        },
      },
    },
  });
  if (!conversation) return;

  let recipientEmail: string | null = null;
  let recipientName = 'there';
  let inboxUrl = appUrl('/personal/chats');

  if (params.senderType === 'PROFESSIONAL' && conversation.recruiter?.email) {
    recipientEmail = conversation.recruiter.email;
    recipientName = displayName(conversation.recruiter);
    inboxUrl =
      conversation.recruiter.role === 'TRAINING_AGENT'
        ? appUrl('/trainingprovider-dashboard/chats')
        : appUrl('/recruiter/chats');
  } else if (
    (params.senderType === 'RECRUITER' || params.senderType === 'ADMIN') &&
    conversation.professional?.email
  ) {
    recipientEmail = conversation.professional.email;
    recipientName = displayName(conversation.professional);
    inboxUrl = appUrl('/personal/chats');
  }

  if (!recipientEmail) return;

  const sender =
    params.senderType === 'ADMIN'
      ? 'Maritime Link Support'
      : params.senderType === 'RECRUITER'
        ? displayName(conversation.recruiter || {})
        : displayName(conversation.professional || {});

  await sendMessageReceivedEmail({
    to: recipientEmail,
    recipientName,
    senderName: sender,
    inboxUrl,
  });
}

export async function notifyCourseBookingPaymentSuccess(
  bookingId: string,
): Promise<void> {
  const booking = await prisma.courseBooking.findUnique({
    where: { id: bookingId },
    include: {
      professional: {
        select: {
          email: true,
          fullname: true,
          firstName: true,
          lastName: true,
        },
      },
      course: {
        select: {
          title: true,
          recruiter: {
            select: {
              email: true,
              role: true,
              organizationName: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      },
    },
  });
  if (!booking?.professional?.email || !booking.course) return;

  const trainer = booking.course.recruiter;
  const trainerDashboard =
    trainer?.role === 'TRAINING_AGENT'
      ? appUrl('/trainingprovider-dashboard/bookings')
      : appUrl('/trainingprovider-dashboard/bookings');

  await sendCourseBookingEmails({
    professional: {
      to: booking.professional.email,
      name: displayName(booking.professional),
      courseTitle: booking.course.title,
      amountPaid: Number(booking.amountPaid),
      currency: booking.currency || 'GBP',
      dashboardUrl: appUrl('/personal/training'),
    },
    trainer: trainer?.email
      ? {
          to: trainer.email,
          name: displayName(trainer),
          courseTitle: booking.course.title,
          dashboardUrl: trainerDashboard,
        }
      : undefined,
  });
}

export async function notifySupportCaseEvent(params: {
  caseDbId: string;
  event: 'created' | 'updated';
  previousStatus?: string;
}): Promise<void> {
  const supportCase = await prisma.supportCase.findUnique({
    where: { id: params.caseDbId },
  });
  if (!supportCase?.userId || !supportCase.userType) return;

  const user = await resolveUserEmail(supportCase.userId, supportCase.userType);
  if (!user) return;

  const isProfessional = supportCase.userType === ActorType.PROFESSIONAL;
  await sendSupportCaseEmail({
    to: user.email,
    recipientName: user.name,
    caseId: supportCase.caseId,
    subject: supportCase.subject,
    status: supportCase.status,
    event: params.event,
    previousStatus: params.previousStatus,
    dashboardUrl: isProfessional
      ? appUrl('/personal/profile')
      : dashboardUrl('RECRUITER', user.recruiterRole),
  });
}

export async function notifyPaymentOutcome(params: {
  professionalId: string;
  success: boolean;
  description: string;
  amount?: number;
  currency?: string;
}): Promise<void> {
  const professional = await prisma.professional.findUnique({
    where: { id: params.professionalId },
    select: { email: true, fullname: true, firstName: true, lastName: true },
  });
  if (!professional?.email) return;

  await sendPaymentStatusEmail({
    to: professional.email,
    recipientName: displayName(professional),
    success: params.success,
    description: params.description,
    amount: params.amount,
    currency: params.currency,
    dashboardUrl: appUrl('/personal/profile/manage-subscription'),
  });
}
