import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import { ApplicationStatus } from '../generated/client/index.js';
import {
  buildEmailHtml,
  emailCallout,
  emailOtpBlock,
  emailParagraph,
  escapeHtml,
} from './emailLayout.js';

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
  },
});

transporter.verify((error) => {
  if (error) {
    console.error('❌ SMTP Connection Error:', error.message);
  } else {
    console.log('✅ SMTP Server is ready to send emails');
  }
});

async function deliver(
  to: string,
  subject: string,
  html: string,
): Promise<void> {
  await transporter.sendMail({
    from: env.SMTP_FROM,
    to,
    subject,
    html,
  });
}

export const sendOTPEmail = async (to: string, otp: string) => {
  await deliver(
    to,
    'Verification code for your Maritime Link account',
    buildEmailHtml({
      headline: 'Verify your email',
      preheader: `Your verification code is ${otp}`,
      greeting: 'Hello,',
      variant: 'brand',
      bodyHtml: `${emailParagraph('Enter this code in the app to verify your email address and continue setting up your account.')}${emailOtpBlock(otp)}`,
    }),
  );
};

export const sendPasswordResetEmail = async (to: string, resetLink: string) => {
  await deliver(
    to,
    'Reset your Maritime Link password',
    buildEmailHtml({
      headline: 'Password reset',
      preheader: 'Reset your Maritime Link password',
      greeting: 'Hello,',
      variant: 'brand',
      bodyHtml: emailParagraph(
        'We received a request to reset your password. Tap the button below to choose a new one. This link expires in 1 hour.',
      ),
      cta: { label: 'Reset password', url: resetLink },
    }),
  );
};

export type KycEmailStatus = 'APPROVED' | 'REJECTED';

export type SendKycStatusEmailParams = {
  to: string;
  recipientName: string;
  accountLabel: string;
  status: KycEmailStatus;
  dashboardUrl: string;
  rejectionReason?: string;
};

export const sendKycStatusEmail = async ({
  to,
  recipientName,
  accountLabel,
  status,
  dashboardUrl,
  rejectionReason,
}: SendKycStatusEmailParams) => {
  const approved = status === 'APPROVED';
  const label = accountLabel.toLowerCase();

  const bodyHtml = approved
    ? `${emailParagraph(`Great news — your <strong>${escapeHtml(label)}</strong> identity verification (KYC) is complete. Your verified badge is now active on your profile.`)}${emailCallout('<strong>✓</strong> You now have full access to platform features that require verification.', 'success')}`
    : `${emailParagraph(`We reviewed your <strong>${escapeHtml(label)}</strong> KYC submission and could not approve it at this time.`)}${
        rejectionReason?.trim()
          ? emailCallout(
              `<strong>Reason:</strong> ${escapeHtml(rejectionReason.trim())}`,
              'danger',
            )
          : ''
      }${emailParagraph('Update your documents and resubmit from your profile, or contact support if you need help.')}`;

  await deliver(
    to,
    approved
      ? 'KYC approved — you are verified'
      : 'KYC not approved — action required',
    buildEmailHtml({
      headline: approved
        ? 'Verification approved'
        : 'Verification not approved',
      preheader: approved
        ? 'Your KYC verification was approved'
        : 'Your KYC verification needs attention',
      greeting: `Hi ${recipientName},`,
      variant: approved ? 'success' : 'danger',
      bodyHtml,
      cta: { label: 'Open dashboard', url: dashboardUrl },
    }),
  );
};

export const sendKycSubmittedEmail = async (params: {
  to: string;
  recipientName: string;
  accountLabel: string;
  dashboardUrl: string;
}) => {
  await deliver(
    params.to,
    'KYC submission received — under review',
    buildEmailHtml({
      headline: 'KYC submitted',
      preheader: 'We received your identity documents',
      greeting: `Hi ${params.recipientName},`,
      variant: 'info',
      bodyHtml: `${emailParagraph(`Thank you — we received your <strong>${escapeHtml(params.accountLabel.toLowerCase())}</strong> identity verification documents.`)}${emailCallout('Our compliance team typically reviews submissions within a few business days. We will email you as soon as there is an update.', 'info')}`,
      cta: { label: 'View status', url: params.dashboardUrl },
    }),
  );
};

export const sendKycResubmissionEmail = async (params: {
  to: string;
  recipientName: string;
  accountLabel: string;
  notes?: string;
  dashboardUrl: string;
}) => {
  await deliver(
    params.to,
    'KYC resubmission requested',
    buildEmailHtml({
      headline: 'Please update your KYC',
      preheader: 'Action required on your verification',
      greeting: `Hi ${params.recipientName},`,
      variant: 'warning',
      bodyHtml: `${emailParagraph(`We need a few updates to your <strong>${escapeHtml(params.accountLabel.toLowerCase())}</strong> identity verification before we can approve it.`)}${
        params.notes?.trim()
          ? emailCallout(
              `<strong>What to fix:</strong> ${escapeHtml(params.notes.trim())}`,
              'warning',
            )
          : emailCallout(
              'Please upload a new ID document, selfie, or any clarification requested by our team.',
              'warning',
            )
      }`,
      cta: { label: 'Update KYC', url: params.dashboardUrl },
    }),
  );
};

export const sendAccountStatusEmail = async (params: {
  to: string;
  recipientName: string;
  accountLabel: string;
  approved: boolean;
  rejectionReason?: string;
  dashboardUrl: string;
}) => {
  const { approved } = params;
  const label = params.accountLabel.toLowerCase();

  await deliver(
    params.to,
    approved
      ? 'Your account has been approved'
      : 'Your account was not approved',
    buildEmailHtml({
      headline: approved ? 'Account approved' : 'Account not approved',
      preheader: approved
        ? 'Welcome to Maritime Link'
        : 'Update on your registration',
      greeting: `Hi ${params.recipientName},`,
      variant: approved ? 'success' : 'danger',
      bodyHtml: approved
        ? `${emailParagraph(`Your <strong>${escapeHtml(label)}</strong> registration (Stage 1) has been <strong>approved</strong>. You can sign in and access your dashboard.`)}${emailCallout('✓ Your account is active. Complete KYC when prompted to unlock verified features.', 'success')}`
        : `${emailParagraph(`Your <strong>${escapeHtml(label)}</strong> registration was not approved at this time.`)}${
            params.rejectionReason?.trim()
              ? emailCallout(
                  `<strong>Reason:</strong> ${escapeHtml(params.rejectionReason.trim())}`,
                  'danger',
                )
              : ''
          }${emailParagraph('Contact support if you have questions about next steps.')}`,
      cta: approved
        ? { label: 'Go to dashboard', url: params.dashboardUrl }
        : undefined,
    }),
  );
};

export const sendAccountSuspendedEmail = async (params: {
  to: string;
  recipientName: string;
  accountLabel: string;
  reason?: string;
}) => {
  const label = params.accountLabel.toLowerCase();

  await deliver(
    params.to,
    'Your account has been suspended',
    buildEmailHtml({
      headline: 'Account suspended',
      preheader: 'Your account access has been paused',
      greeting: `Hi ${params.recipientName},`,
      variant: 'danger',
      bodyHtml: `${emailParagraph(`Your ${escapeHtml(label)} account has been <strong>suspended</strong> and you no longer have access to your dashboard.`)}${
        params.reason?.trim()
          ? emailCallout(
              `<strong>Reason:</strong> ${escapeHtml(params.reason.trim())}`,
              'danger',
            )
          : ''
      }${emailParagraph('Contact support if you believe this is a mistake or need more information.')}`,
    }),
  );
};

export const sendAccountReinstatedEmail = async (params: {
  to: string;
  recipientName: string;
  accountLabel: string;
  dashboardUrl: string;
}) => {
  const label = params.accountLabel.toLowerCase();

  await deliver(
    params.to,
    'Your account access has been restored',
    buildEmailHtml({
      headline: 'Account reinstated',
      preheader: 'Welcome back to Maritime Link',
      greeting: `Hi ${params.recipientName},`,
      variant: 'success',
      bodyHtml: `${emailParagraph(`Your ${escapeHtml(label)} account has been <strong>reinstated</strong>. You can sign in and access your dashboard again.`)}${emailCallout('✓ Your account is active again.', 'success')}`,
      cta: { label: 'Go to dashboard', url: params.dashboardUrl },
    }),
  );
};

export const sendJobApplicationEmails = async (params: {
  professional: {
    to: string;
    name: string;
    jobTitle: string;
    dashboardUrl: string;
  };
  recruiter?: {
    to: string;
    name: string;
    jobTitle: string;
    applicantName: string;
    dashboardUrl: string;
  };
}) => {
  const job = escapeHtml(params.professional.jobTitle);

  await deliver(
    params.professional.to,
    `Application submitted: ${params.professional.jobTitle}`,
    buildEmailHtml({
      headline: 'Application sent',
      preheader: `Application submitted for ${params.professional.jobTitle}`,
      greeting: `Hi ${params.professional.name},`,
      variant: 'success',
      bodyHtml: `${emailParagraph(`Your application for <strong>${job}</strong> was submitted successfully.`)}${emailCallout('The hiring team will review your profile. We will notify you when your status changes.', 'info')}`,
      cta: { label: 'View application', url: params.professional.dashboardUrl },
    }),
  );

  if (params.recruiter) {
    const applicant = escapeHtml(params.recruiter.applicantName);
    await deliver(
      params.recruiter.to,
      `New applicant: ${params.recruiter.jobTitle}`,
      buildEmailHtml({
        headline: 'New application received',
        preheader: `${params.recruiter.applicantName} applied for ${params.recruiter.jobTitle}`,
        greeting: `Hi ${params.recruiter.name},`,
        variant: 'brand',
        bodyHtml: `${emailParagraph(`<strong>${applicant}</strong> just applied for your open role <strong>${job}</strong>.`)}${emailCallout('Review their profile, documents, and match score in your recruiter dashboard.', 'brand')}`,
        cta: { label: 'Review applicant', url: params.recruiter.dashboardUrl },
      }),
    );
  }
};

export const sendJobInvitationEmail = async (params: {
  to: string;
  recipientName: string;
  jobTitle: string;
  senderName: string;
  jobUrl: string;
}) => {
  await deliver(
    params.to,
    `You are invited to apply: ${params.jobTitle}`,
    buildEmailHtml({
      headline: 'Job invitation',
      preheader: `${params.senderName} invited you to apply`,
      greeting: `Hi ${params.recipientName},`,
      variant: 'info',
      bodyHtml: `${emailParagraph(`<strong>${escapeHtml(params.senderName)}</strong> thinks you are a strong match and invited you to apply for <strong>${escapeHtml(params.jobTitle)}</strong>.`)}${emailCallout('This invitation is personal to you — apply when you are ready from the job page.', 'info')}`,
      cta: { label: 'View job & apply', url: params.jobUrl },
    }),
  );
};

export const sendJobPublishedEmail = async (params: {
  to: string;
  recipientName: string;
  jobTitle: string;
  dashboardUrl: string;
}) => {
  const job = escapeHtml(params.jobTitle);

  await deliver(
    params.to,
    `Your job is live: ${params.jobTitle}`,
    buildEmailHtml({
      headline: 'Job published',
      preheader: `${params.jobTitle} is now live`,
      greeting: `Hi ${params.recipientName},`,
      variant: 'success',
      bodyHtml: `${emailParagraph(`Your job listing <strong>${job}</strong> is now live and visible to professionals on Maritime Link.`)}${emailCallout('Track applications and invitations from your recruiter dashboard.', 'success')}`,
      cta: { label: 'View job', url: params.dashboardUrl },
    }),
  );
};

const APPLICATION_STATUS_LABELS: Partial<Record<ApplicationStatus, string>> = {
  [ApplicationStatus.APPLIED]: 'Applied',
  [ApplicationStatus.UNDER_REVIEW]: 'Under review',
  [ApplicationStatus.SHORTLISTED]: 'Shortlisted',
  [ApplicationStatus.INTERVIEW]: 'Interview',
  [ApplicationStatus.OFFER]: 'Offer',
  [ApplicationStatus.HIRED]: 'Hired',
  [ApplicationStatus.REJECTED]: 'Not selected',
  [ApplicationStatus.WITHDRAWN]: 'Withdrawn',
};

export const sendApplicationStatusEmail = async (params: {
  to: string;
  recipientName: string;
  jobTitle: string;
  status: ApplicationStatus;
  rejectionReason?: string | null;
  dashboardUrl: string;
}) => {
  const label =
    APPLICATION_STATUS_LABELS[params.status] ||
    params.status.replace(/_/g, ' ');
  const rejected = params.status === ApplicationStatus.REJECTED;
  const job = escapeHtml(params.jobTitle);

  await deliver(
    params.to,
    `Application update: ${params.jobTitle}`,
    buildEmailHtml({
      headline: 'Application status updated',
      preheader: `Status: ${label} — ${params.jobTitle}`,
      greeting: `Hi ${params.recipientName},`,
      variant: rejected ? 'danger' : 'info',
      bodyHtml: `${emailParagraph(`Your application for <strong>${job}</strong> has been updated.`)}${emailCallout(`<strong>Current status:</strong> ${escapeHtml(label)}`, rejected ? 'danger' : 'success')}${
        rejected && params.rejectionReason?.trim()
          ? emailCallout(
              `<strong>Feedback:</strong> ${escapeHtml(params.rejectionReason.trim())}`,
              'danger',
            )
          : ''
      }`,
      cta: { label: 'View my jobs', url: params.dashboardUrl },
    }),
  );
};

export const sendMessageReceivedEmail = async (params: {
  to: string;
  recipientName: string;
  senderName: string;
  inboxUrl: string;
}) => {
  await deliver(
    params.to,
    `New message from ${params.senderName}`,
    buildEmailHtml({
      headline: 'New message',
      preheader: `Message from ${params.senderName}`,
      greeting: `Hi ${params.recipientName},`,
      variant: 'brand',
      bodyHtml: `${emailParagraph(`You have a new message from <strong>${escapeHtml(params.senderName)}</strong> on Maritime Link.`)}${emailCallout('Open your inbox to read and reply while the conversation is active.', 'brand')}`,
      cta: { label: 'Open inbox', url: params.inboxUrl },
    }),
  );
};

export const sendCourseBookingEmails = async (params: {
  professional: {
    to: string;
    name: string;
    courseTitle: string;
    amountPaid: number;
    currency: string;
    dashboardUrl: string;
  };
  trainer?: {
    to: string;
    name: string;
    courseTitle: string;
    dashboardUrl: string;
  };
}) => {
  const amount = `${params.professional.currency} ${params.professional.amountPaid.toFixed(2)}`;
  const course = escapeHtml(params.professional.courseTitle);

  await deliver(
    params.professional.to,
    `Training booking confirmed: ${params.professional.courseTitle}`,
    buildEmailHtml({
      headline: 'Booking confirmed',
      preheader: `Confirmed: ${params.professional.courseTitle}`,
      greeting: `Hi ${params.professional.name},`,
      variant: 'success',
      bodyHtml: `${emailParagraph(`Your booking for <strong>${course}</strong> is confirmed.`)}${emailCallout(`<strong>Amount paid:</strong> ${escapeHtml(amount)}`, 'success')}`,
      cta: { label: 'View training', url: params.professional.dashboardUrl },
    }),
  );

  if (params.trainer) {
    await deliver(
      params.trainer.to,
      `New training booking: ${params.trainer.courseTitle}`,
      buildEmailHtml({
        headline: 'New booking received',
        preheader: `New booking: ${params.trainer.courseTitle}`,
        greeting: `Hi ${params.trainer.name},`,
        variant: 'brand',
        bodyHtml: `${emailParagraph(`A professional has booked <strong>${escapeHtml(params.trainer.courseTitle)}</strong>.`)}${emailCallout('Review attendee details and session capacity in your provider dashboard.', 'brand')}`,
        cta: { label: 'View bookings', url: params.trainer.dashboardUrl },
      }),
    );
  }
};

export const sendCourseBookingCancelledEmail = async (params: {
  to: string;
  recipientName: string;
  courseTitle: string;
  audience: 'PROFESSIONAL' | 'PROVIDER';
  refunded?: boolean;
  dashboardUrl: string;
}) => {
  const course = escapeHtml(params.courseTitle);
  const forProfessional = params.audience === 'PROFESSIONAL';

  const bodyHtml = forProfessional
    ? `${emailParagraph(`Your booking for <strong>${course}</strong> has been <strong>cancelled</strong> by the training provider.`)}${
        params.refunded
          ? emailCallout(
              'A full refund has been issued and may take 5–10 business days to appear on your card.',
              'success',
            )
          : ''
      }`
    : `${emailParagraph(`A professional has <strong>cancelled</strong> their booking for <strong>${course}</strong>.`)}${emailCallout('The seat has been released back to your available capacity.', 'brand')}`;

  await deliver(
    params.to,
    `Booking cancelled: ${params.courseTitle}`,
    buildEmailHtml({
      headline: 'Booking cancelled',
      preheader: `Cancelled: ${params.courseTitle}`,
      greeting: `Hi ${params.recipientName},`,
      variant: forProfessional ? 'danger' : 'brand',
      bodyHtml,
      cta: {
        label: forProfessional ? 'View training' : 'View bookings',
        url: params.dashboardUrl,
      },
    }),
  );
};

export const sendCoursePublishedEmail = async (params: {
  to: string;
  recipientName: string;
  courseTitle: string;
  dashboardUrl: string;
}) => {
  const course = escapeHtml(params.courseTitle);

  await deliver(
    params.to,
    `Your course is live: ${params.courseTitle}`,
    buildEmailHtml({
      headline: 'Course published',
      preheader: `${params.courseTitle} is now live`,
      greeting: `Hi ${params.recipientName},`,
      variant: 'success',
      bodyHtml: `${emailParagraph(`Your course <strong>${course}</strong> is now live and open for bookings on Maritime Link.`)}${emailCallout('Manage sessions, capacity, and bookings from your provider dashboard.', 'success')}`,
      cta: { label: 'View course', url: params.dashboardUrl },
    }),
  );
};

export const sendSupportCaseEmail = async (params: {
  to: string;
  recipientName: string;
  caseId: string;
  subject: string;
  status: string;
  event: 'created' | 'updated';
  previousStatus?: string;
  dashboardUrl: string;
}) => {
  const created = params.event === 'created';

  await deliver(
    params.to,
    created
      ? `Support case opened: ${params.caseId}`
      : `Support case updated: ${params.caseId}`,
    buildEmailHtml({
      headline: created ? 'Support case created' : 'Support case updated',
      preheader: `${params.caseId} — ${params.subject}`,
      greeting: `Hi ${params.recipientName},`,
      variant: 'info',
      bodyHtml: created
        ? `${emailParagraph(`We received your support request and created case <strong>${escapeHtml(params.caseId)}</strong>.`)}${emailCallout(`<strong>Subject:</strong> ${escapeHtml(params.subject)}<br/><strong>Status:</strong> ${escapeHtml(params.status)}`, 'info')}`
        : `${emailParagraph(`Your support case <strong>${escapeHtml(params.caseId)}</strong> was updated.`)}${emailCallout(`<strong>Status:</strong> ${escapeHtml(params.previousStatus || '—')} → <strong>${escapeHtml(params.status)}</strong>`, 'info')}`,
      cta: { label: 'View cases', url: params.dashboardUrl },
    }),
  );
};

export const sendPaymentStatusEmail = async (params: {
  to: string;
  recipientName: string;
  success: boolean;
  description: string;
  amount?: number;
  currency?: string;
  dashboardUrl: string;
}) => {
  const amountLine =
    params.amount != null && params.currency
      ? emailCallout(
          `<strong>Amount:</strong> ${escapeHtml(params.currency)} ${params.amount.toFixed(2)}`,
          params.success ? 'success' : 'danger',
        )
      : '';

  await deliver(
    params.to,
    params.success ? 'Payment successful' : 'Payment failed',
    buildEmailHtml({
      headline: params.success ? 'Payment successful' : 'Payment failed',
      preheader: params.success
        ? 'Your payment was processed'
        : 'Payment could not be completed',
      greeting: `Hi ${params.recipientName},`,
      variant: params.success ? 'success' : 'danger',
      bodyHtml: `${emailParagraph(escapeHtml(params.description))}${amountLine}${
        params.success
          ? ''
          : emailParagraph(
              'Please try again or update your payment method in billing settings.',
            )
      }`,
      cta: { label: 'Manage billing', url: params.dashboardUrl },
    }),
  );
};

export const sendDocumentExpiryEmail = async (params: {
  to: string;
  recipientName: string;
  documentName: string;
  expiryDate: string;
  expired: boolean;
  dashboardUrl: string;
}) => {
  const { expired } = params;
  const doc = escapeHtml(params.documentName);
  const date = escapeHtml(params.expiryDate);

  await deliver(
    params.to,
    expired
      ? `Document expired: ${params.documentName}`
      : `Document expiring soon: ${params.documentName}`,
    buildEmailHtml({
      headline: expired ? 'Document expired' : 'Document expiring soon',
      preheader: expired
        ? `${params.documentName} has expired`
        : `${params.documentName} expires soon`,
      greeting: `Hi ${params.recipientName},`,
      variant: expired ? 'danger' : 'warning',
      bodyHtml: expired
        ? `${emailParagraph(`<strong>${doc}</strong> expired on <strong>${date}</strong>.`)}${emailCallout('Your compliance status may be affected until you upload a renewed document to your wallet.', 'danger')}`
        : `${emailParagraph(`<strong>${doc}</strong> expires on <strong>${date}</strong>.`)}${emailCallout('Renew and upload an updated certificate before the expiry date to stay compliant.', 'warning')}`,
      cta: { label: 'Open document wallet', url: params.dashboardUrl },
    }),
  );
};

export const sendSecureDocumentLinkEmail = async (params: {
  to: string;
  recipientName: string;
  secureLink: string;
  expiresAt: string;
  dashboardUrl: string;
}) => {
  await deliver(
    params.to,
    'Secure document link created',
    buildEmailHtml({
      headline: 'Secure document link shared',
      preheader: 'A secure share link for your documents was created',
      greeting: `Hi ${params.recipientName},`,
      variant: 'info',
      bodyHtml: `${emailParagraph('A secure, time-limited link to your document pack was generated from your account.')}${emailCallout(`<strong>Link:</strong> <a href="${escapeHtml(params.secureLink)}" target="_blank">${escapeHtml(params.secureLink)}</a><br/><strong>Expires:</strong> ${escapeHtml(params.expiresAt)}`, 'info')}${emailParagraph("If you didn't request this, please review your account security.")}`,
      cta: { label: 'Open document wallet', url: params.dashboardUrl },
    }),
  );
};

export const sendPhoneOTPEmail = async (to: string, otp: string) => {
  await deliver(
    to,
    'Phone verification code',
    buildEmailHtml({
      headline: 'Phone verification',
      preheader: `Your phone verification code is ${otp}`,
      greeting: 'Hello,',
      variant: 'brand',
      bodyHtml: `${emailParagraph('Use this code to verify your phone number on Maritime Link.')}${emailOtpBlock(otp)}`,
    }),
  );
};
