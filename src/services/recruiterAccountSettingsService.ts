import { Prisma } from '../generated/client/index.js';

export type RecruiterNotificationPreferences = {
  securityAlerts: boolean;
  newApplications: boolean;
  candidateMessages: boolean;
  jobPostings: boolean;
  marketing: boolean;
  desktopSounds: boolean;
  urgentAlerts: boolean;
};

export const DEFAULT_RECRUITER_NOTIFICATION_PREFERENCES: RecruiterNotificationPreferences =
  {
    securityAlerts: true,
    newApplications: true,
    candidateMessages: true,
    jobPostings: true,
    marketing: false,
    desktopSounds: true,
    urgentAlerts: true,
  };

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const parseBoolean = (value: unknown, fallback: boolean) => {
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === 1 || value === '1') return true;
  if (value === 'false' || value === 0 || value === '0') return false;
  return fallback;
};

export const normalizeNotificationPreferences = (
  payload: Record<string, unknown>,
): RecruiterNotificationPreferences => ({
  securityAlerts: parseBoolean(
    payload.securityAlerts,
    DEFAULT_RECRUITER_NOTIFICATION_PREFERENCES.securityAlerts,
  ),
  newApplications: parseBoolean(
    payload.newApplications,
    DEFAULT_RECRUITER_NOTIFICATION_PREFERENCES.newApplications,
  ),
  candidateMessages: parseBoolean(
    payload.candidateMessages,
    DEFAULT_RECRUITER_NOTIFICATION_PREFERENCES.candidateMessages,
  ),
  jobPostings: parseBoolean(
    payload.jobPostings,
    DEFAULT_RECRUITER_NOTIFICATION_PREFERENCES.jobPostings,
  ),
  marketing: parseBoolean(
    payload.marketing,
    DEFAULT_RECRUITER_NOTIFICATION_PREFERENCES.marketing,
  ),
  desktopSounds: parseBoolean(
    payload.desktopSounds,
    DEFAULT_RECRUITER_NOTIFICATION_PREFERENCES.desktopSounds,
  ),
  urgentAlerts: parseBoolean(
    payload.urgentAlerts,
    DEFAULT_RECRUITER_NOTIFICATION_PREFERENCES.urgentAlerts,
  ),
});

const readLegacyNotificationPreferences = (
  organizationVerificationData: unknown,
): Partial<RecruiterNotificationPreferences> => {
  if (!isRecord(organizationVerificationData)) return {};
  const settings = isRecord(organizationVerificationData._recruiterSettings)
    ? organizationVerificationData._recruiterSettings
    : {};
  const notifications = isRecord(settings.notifications)
    ? settings.notifications
    : {};
  return normalizeNotificationPreferences(notifications);
};

export const getRecruiterNotificationPreferences = (
  accountSettings: unknown,
  organizationVerificationData?: unknown,
): RecruiterNotificationPreferences => {
  const legacy = readLegacyNotificationPreferences(
    organizationVerificationData,
  );

  if (!isRecord(accountSettings)) {
    return {
      ...DEFAULT_RECRUITER_NOTIFICATION_PREFERENCES,
      ...legacy,
    };
  }

  const stored = isRecord(accountSettings.notifications)
    ? accountSettings.notifications
    : {};

  return {
    ...DEFAULT_RECRUITER_NOTIFICATION_PREFERENCES,
    ...legacy,
    ...normalizeNotificationPreferences(stored),
  };
};

export const mergeRecruiterAccountSettings = (
  current: unknown,
  notifications: RecruiterNotificationPreferences,
): Prisma.InputJsonValue => {
  const base: JsonRecord = isRecord(current) ? { ...current } : {};
  base.notifications = notifications;
  return base as Prisma.InputJsonValue;
};

export type RecruiterNotificationItem = {
  id: string;
  type?: string;
  severity?: string;
  title?: string;
  message?: string;
  createdAt?: Date;
};

/** Course booking alerts for training providers — always shown (operational). */
export const isCourseBookingNotification = (
  notification: RecruiterNotificationItem,
): boolean => {
  const id = String(notification.id || '');
  const title = String(notification.title || '');
  return (
    id === 'pending-bookings' ||
    id === 'awaiting-approval-bookings' ||
    id.startsWith('booking-') ||
    title === 'Recent Course Booking' ||
    title === 'New Booking Requests' ||
    title === 'Bookings Awaiting Approval' ||
    title === 'Incomplete Bookings'
  );
};

/** Returns true when the in-app notification should be shown for this recruiter. */
export const isRecruiterInAppNotificationEnabled = (
  notification: RecruiterNotificationItem,
  preferences: RecruiterNotificationPreferences,
): boolean => {
  const id = String(notification.id || '');

  if (isCourseBookingNotification(notification)) {
    return true;
  }

  if (id === 'new-applications' || id === 'pending-bookings') {
    if (!preferences.newApplications) return false;
  } else if (
    id === 'zero-applicant-jobs' ||
    id === 'draft-jobs' ||
    id === 'courses-no-sessions' ||
    id.startsWith('expiring-') ||
    id.startsWith('capacity-')
  ) {
    if (!preferences.jobPostings) return false;
  } else if (
    id.includes('message') ||
    id.includes('chat') ||
    notification.type === 'message' ||
    notification.type === 'chat'
  ) {
    if (!preferences.candidateMessages) return false;
  } else if (id === 'recruiter-announcement' || id === 'trainer-announcement') {
    return false;
  }

  return true;
};

export const filterRecruiterInAppNotifications = (
  notifications: RecruiterNotificationItem[],
  preferences: RecruiterNotificationPreferences,
) =>
  notifications.filter((item) =>
    isRecruiterInAppNotificationEnabled(item, preferences),
  );
