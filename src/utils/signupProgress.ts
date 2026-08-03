/**
 * Where an account is in the multi-step signup wizard.
 *
 * `registrationStep` is advanced by each wizard step, and the final step is the
 * one that issues a token. An account that stopped short of it never finished
 * signing up: it has no company details, no verified phone, no profession, and
 * so on, so dropping it on a dashboard leaves the user stuck with a half-built
 * account and no way to finish. Login uses these helpers to send them back to
 * the step they left off at instead.
 */

/** Recruiter / Training Agent: step 6 = compliance declaration submitted. */
export const RECRUITER_SIGNUP_COMPLETE_STEP = 6;

/** Professional: step 5 = role (subcategory) selected. */
export const PROFESSIONAL_SIGNUP_COMPLETE_STEP = 5;

export const SIGNUP_INCOMPLETE_CODE = 'SIGNUP_INCOMPLETE';

export const SIGNUP_INCOMPLETE_MESSAGE =
  'You have not finished setting up your account. Continue where you left off to complete your registration.';

/**
 * Accounts created outside the wizard — seeded, imported, or admin-created —
 * can sit on a low `registrationStep` while being perfectly usable, and must
 * never be pushed back into signup. Approval is the signal that an account is
 * past onboarding, so only accounts still awaiting it are treated as
 * mid-signup.
 */
const isAwaitingOnboarding = (status: string | null | undefined) =>
  String(status || '').toUpperCase() === 'PENDING';

export const isRecruiterSignupIncomplete = (recruiter: {
  status: string | null | undefined;
  registrationStep: number | null | undefined;
}) =>
  isAwaitingOnboarding(recruiter.status) &&
  (recruiter.registrationStep ?? 1) < RECRUITER_SIGNUP_COMPLETE_STEP;

export const isProfessionalSignupIncomplete = (professional: {
  status: string | null | undefined;
  registrationStep: number | null | undefined;
}) =>
  isAwaitingOnboarding(professional.status) &&
  (professional.registrationStep ?? 1) < PROFESSIONAL_SIGNUP_COMPLETE_STEP;
