const noop = () => Promise.resolve();

/**
 * Full emailService mock — required because jest replaces the entire module,
 * so any export missing here becomes an import error in whatever pulls it in
 * (eventNotificationService, the moderation services, ...). Keep in step with
 * the exports of `src/services/emailService.ts`.
 */
export const createEmailServiceMock = () => ({
  sendOTPEmail: noop,
  sendPasswordResetEmail: noop,
  sendPhoneOTPEmail: noop,
  sendKycStatusEmail: noop,
  sendKycSubmittedEmail: noop,
  sendKycResubmissionEmail: noop,
  sendAccountStatusEmail: noop,
  sendAccountSuspendedEmail: noop,
  sendAccountReinstatedEmail: noop,
  sendAccountReportAcknowledgementEmail: noop,
  sendAccountReportResolvedEmail: noop,
  sendJobApplicationEmails: noop,
  sendJobInvitationEmail: noop,
  sendJobPublishedEmail: noop,
  sendApplicationStatusEmail: noop,
  sendMessageReceivedEmail: noop,
  sendCourseBookingEmails: noop,
  sendCourseBookingCancelledEmail: noop,
  sendCoursePublishedEmail: noop,
  sendSupportCaseEmail: noop,
  sendPaymentStatusEmail: noop,
  sendDocumentExpiryEmail: noop,
  sendDocumentExpiryDigestEmail: noop,
  sendSecureDocumentLinkEmail: noop,
  sendCompleteProfileRequestEmail: noop,
  sendAnnouncementEmail: noop,
});
