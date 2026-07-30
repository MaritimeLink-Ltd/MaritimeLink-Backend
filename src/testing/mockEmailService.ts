const noop = () => Promise.resolve();

/** Full emailService mock — required because jest replaces the entire module. */
export const createEmailServiceMock = () => ({
  sendOTPEmail: noop,
  sendPasswordResetEmail: noop,
  sendPhoneOTPEmail: noop,
  sendKycStatusEmail: noop,
  sendKycSubmittedEmail: noop,
  sendKycResubmissionEmail: noop,
  sendAccountStatusEmail: noop,
  sendJobApplicationEmails: noop,
  sendJobInvitationEmail: noop,
  sendApplicationStatusEmail: noop,
  sendMessageReceivedEmail: noop,
  sendCourseBookingEmails: noop,
  sendSupportCaseEmail: noop,
  sendPaymentStatusEmail: noop,
  sendDocumentExpiryEmail: noop,
  sendDocumentExpiryDigestEmail: noop,
});
