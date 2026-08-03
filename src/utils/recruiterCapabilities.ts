/**
 * Free Recruiter cap: max simultaneously active *unpaid* job listings.
 * Flex listings are bought per job and are excluded from this count, so a Flex
 * recruiter can run unlimited listings as long as each one is paid for.
 */
export const RECRUITER_FREE_ACTIVE_JOB_LIMIT = 1;

/** Free Recruiter cap: max applications accepted per non-premium job listing. */
export const RECRUITER_FREE_JOB_APPLICATION_LIMIT = 5;

export interface RecruiterListingLike {
  isPremiumListing: boolean;
  premiumListingExpiresAt: Date | null;
}

/** A Flex-purchased listing upgrade is only in effect until it expires (30 days). */
export function isJobPremiumActive(job: RecruiterListingLike): boolean {
  return Boolean(
    job.isPremiumListing &&
    job.premiumListingExpiresAt &&
    job.premiumListingExpiresAt.getTime() > Date.now(),
  );
}

export interface RecruiterFeatureAccess {
  unlimitedApplications: boolean;
  smartMatching: boolean;
  inviteCandidates: boolean;
  viewResume: boolean;
  viewDocumentWallet: boolean;
  directMessagingBeforeApplication: boolean;
  csvExport: boolean;
  premiumBadge: boolean;
  priorityListing: boolean;
}

/**
 * Computes what a recruiter can do for a given job context.
 * Premium Recruiter (recurring subscription) unlocks everything everywhere.
 * A Free recruiter only gets the Flex-tier feature set on a specific job that
 * has an active (unexpired) Flex listing upgrade.
 *
 * Flex is deliberately NOT a licence to browse the candidate pool: a Flex
 * recruiter reaches a candidate's resume only through a listing they have paid
 * for — either the candidate applied to that listing, or the matching engine
 * matched them to it. Blanket resume access stays a Premium feature.
 */
export function getRecruiterFeatureAccess(params: {
  recruiterTier: string | null | undefined;
  job?: RecruiterListingLike | null;
  /**
   * Has the candidate in context been matched by the platform to one of this
   * recruiter's currently-active Flex listings? Only meaningful for the
   * candidate-scoped endpoints; leave unset elsewhere.
   */
  candidateMatchedToActiveFlexListing?: boolean;
}): RecruiterFeatureAccess {
  const isPremiumRecruiter =
    String(params.recruiterTier || 'FREE').toUpperCase() === 'PREMIUM';

  if (isPremiumRecruiter) {
    return {
      unlimitedApplications: true,
      smartMatching: true,
      inviteCandidates: true,
      viewResume: true,
      viewDocumentWallet: true,
      directMessagingBeforeApplication: true,
      csvExport: true,
      premiumBadge: true,
      priorityListing: true,
    };
  }

  const jobFlexActive = Boolean(params.job && isJobPremiumActive(params.job));

  return {
    unlimitedApplications: jobFlexActive,
    smartMatching: jobFlexActive,
    inviteCandidates: jobFlexActive,
    // Applicants on a paid listing, plus candidates the platform matched to one.
    viewResume:
      jobFlexActive || Boolean(params.candidateMatchedToActiveFlexListing),
    // Wallet stays applicant-only: it needs the candidate to have applied to the
    // paid listing, so a match alone is not enough.
    viewDocumentWallet: jobFlexActive,
    directMessagingBeforeApplication: false,
    csvExport: false,
    premiumBadge: false,
    priorityListing: false,
  };
}
