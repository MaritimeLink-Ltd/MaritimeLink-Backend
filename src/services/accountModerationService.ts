import { prisma } from '../config/prisma.js';
import {
  ProfessionalStatus,
  RecruiterStatus,
} from '../generated/client/index.js';

/**
 * Account moderation shared between admin actions and access enforcement.
 *
 * Three distinct states, matching the platform policy:
 *  - SUSPENDED — reversible. Access is paused; an admin can reinstate, or an
 *    optional `suspendedUntil` lets it lapse on its own.
 *  - BLOCKED   — permanent suspension for severe cases. Reinstating is still
 *    possible (appeals) but is an explicit admin decision.
 *  - reinstate — returns the account to the status it held before moderation.
 */

export type ModeratedAccountKind = 'professional' | 'recruiter' | 'trainer';

/** Statuses that deny platform access. */
const RESTRICTED_STATUSES = new Set<string>(['SUSPENDED', 'BLOCKED']);

/** Status an account falls back to when reinstated with no recorded history. */
const DEFAULT_REINSTATE_STATUS = {
  professional: ProfessionalStatus.VERIFIED,
  recruiter: RecruiterStatus.APPROVED,
} as const;

export const isRestrictedStatus = (status?: string | null) =>
  RESTRICTED_STATUSES.has(String(status || '').toUpperCase());

type ModerationFields = {
  status: string;
  suspendedUntil?: Date | null;
  suspensionReason?: string | null;
  suspendedAt?: Date | null;
};

/**
 * Human-readable reason shown on a blocked login / request. Returns null when the
 * account is not restricted.
 */
export const describeRestriction = (
  account: ModerationFields | null | undefined,
): string | null => {
  if (!account || !isRestrictedStatus(account.status)) return null;

  const isBlocked = String(account.status).toUpperCase() === 'BLOCKED';
  const reason = account.suspensionReason?.trim();

  const base = isBlocked
    ? 'Your account has been permanently suspended for breaching our platform policy.'
    : account.suspendedUntil
      ? `Your account is suspended until ${account.suspendedUntil.toISOString().slice(0, 10)}.`
      : 'Your account is currently suspended.';

  return [
    base,
    reason ? `Reason: ${reason}` : '',
    'Contact support if you would like to appeal this decision.',
  ]
    .filter(Boolean)
    .join(' ');
};

/**
 * Clears a temporary suspension whose `suspendedUntil` has passed, restoring the
 * account's pre-suspension status. Returns the effective status to use.
 *
 * Called from login and from the auth middlewares so a lapsed suspension lifts
 * itself without an admin having to act.
 */
export const liftExpiredProfessionalSuspension = async (professional: {
  id: string;
  status: ProfessionalStatus;
  suspendedUntil: Date | null;
  statusBeforeSuspension: ProfessionalStatus | null;
}): Promise<ProfessionalStatus> => {
  if (
    professional.status !== ProfessionalStatus.SUSPENDED ||
    !professional.suspendedUntil ||
    professional.suspendedUntil.getTime() > Date.now()
  ) {
    return professional.status;
  }

  const restored =
    professional.statusBeforeSuspension ??
    DEFAULT_REINSTATE_STATUS.professional;

  await prisma.professional.update({
    where: { id: professional.id },
    data: {
      status: restored,
      suspendedAt: null,
      suspendedUntil: null,
      suspensionReason: null,
      suspendedById: null,
      statusBeforeSuspension: null,
    },
  });

  return restored;
};

export const liftExpiredRecruiterSuspension = async (recruiter: {
  id: string;
  status: RecruiterStatus;
  suspendedUntil: Date | null;
  statusBeforeSuspension: RecruiterStatus | null;
}): Promise<RecruiterStatus> => {
  if (
    recruiter.status !== RecruiterStatus.SUSPENDED ||
    !recruiter.suspendedUntil ||
    recruiter.suspendedUntil.getTime() > Date.now()
  ) {
    return recruiter.status;
  }

  const restored =
    recruiter.statusBeforeSuspension ?? DEFAULT_REINSTATE_STATUS.recruiter;

  await prisma.recruiter.update({
    where: { id: recruiter.id },
    data: {
      status: restored,
      suspendedAt: null,
      suspendedUntil: null,
      suspensionReason: null,
      suspendedById: null,
      statusBeforeSuspension: null,
    },
  });

  return restored;
};

/** Status to restore on reinstate, given what the account held before moderation. */
export const resolveProfessionalReinstateStatus = (
  statusBeforeSuspension: ProfessionalStatus | null,
): ProfessionalStatus => {
  // Never reinstate straight back into a restricted state.
  if (!statusBeforeSuspension || isRestrictedStatus(statusBeforeSuspension)) {
    return DEFAULT_REINSTATE_STATUS.professional;
  }
  return statusBeforeSuspension;
};

export const resolveRecruiterReinstateStatus = (
  statusBeforeSuspension: RecruiterStatus | null,
): RecruiterStatus => {
  if (!statusBeforeSuspension || isRestrictedStatus(statusBeforeSuspension)) {
    return DEFAULT_REINSTATE_STATUS.recruiter;
  }
  return statusBeforeSuspension;
};

/** Maps a recruiter row to the account kind used across the moderation APIs. */
export const recruiterKind = (
  role?: string | null,
): Exclude<ModeratedAccountKind, 'professional'> =>
  role === 'TRAINING_AGENT' ? 'trainer' : 'recruiter';
