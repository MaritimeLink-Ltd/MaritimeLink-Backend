import { Request } from 'express';
import { prisma } from '../config/prisma.js';
import { AppError } from './AppError.js';
import {
  isProfessionalSignupIncomplete,
  isRecruiterSignupIncomplete,
} from './signupProgress.js';

/**
 * Guards the signup-wizard steps that identify the account by an id sent in the
 * request body (profession, photo, role, company details, compliance, ...).
 *
 * Those steps run before the user has a session, so they cannot simply require
 * a login. Without a guard, though, anyone who learned an account's id could
 * replay a step against it — and the final step hands back a 7-day session.
 *
 * A step is allowed only while the account is still mid-signup (email
 * verified, wizard not finished) — the only situation in which the website
 * and the app call these endpoints. Finished accounts edit their details
 * through the logged-in settings endpoints instead, so a finished account can
 * never be changed (or have its company "re-verified") through the wizard.
 * The request/response shapes of the endpoints are unchanged.
 */

export const SIGNUP_STEP_UNAVAILABLE_MESSAGE =
  'Your account setup is already complete. Please log in to make changes.';

const isUuidLike = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f-]{32,36}$/i.test(value);

/**
 * Resolves to an AppError when the step must be refused, or null when allowed.
 */
export const checkProfessionalSignupStep = async (
  _req: Request,
  professionalId: unknown,
  { requireVerified = true }: { requireVerified?: boolean } = {},
): Promise<AppError | null> => {
  if (!isUuidLike(professionalId)) {
    return new AppError('Professional ID is required', 400);
  }

  const professional = await prisma.professional.findUnique({
    where: { id: professionalId },
    select: {
      id: true,
      status: true,
      registrationStep: true,
      isVerified: true,
    },
  });
  if (!professional) {
    return new AppError('User not found', 404);
  }

  if (!isProfessionalSignupIncomplete(professional)) {
    return new AppError(SIGNUP_STEP_UNAVAILABLE_MESSAGE, 403);
  }

  if (requireVerified && !professional.isVerified) {
    return new AppError(
      'Please verify your email before continuing your registration.',
      403,
    );
  }

  return null;
};

/**
 * Same rule for recruiters / training agents (they share one table).
 */
export const checkRecruiterSignupStep = async (
  _req: Request,
  recruiterId: unknown,
  { requireVerified = true }: { requireVerified?: boolean } = {},
): Promise<AppError | null> => {
  if (!isUuidLike(recruiterId)) {
    return new AppError('recruiterId is required', 400);
  }

  const recruiter = await prisma.recruiter.findUnique({
    where: { id: recruiterId },
    select: {
      id: true,
      status: true,
      registrationStep: true,
      isVerified: true,
    },
  });
  if (!recruiter) {
    return new AppError('Recruiter not found', 404);
  }

  if (!isRecruiterSignupIncomplete(recruiter)) {
    return new AppError(SIGNUP_STEP_UNAVAILABLE_MESSAGE, 403);
  }

  if (requireVerified && !recruiter.isVerified) {
    return new AppError(
      'Please verify your email before continuing your registration.',
      403,
    );
  }

  return null;
};
