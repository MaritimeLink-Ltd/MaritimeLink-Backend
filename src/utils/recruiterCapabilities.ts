/** Free Recruiter cap: max simultaneously active job listings. */
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
 * has an active (unexpired) Flex listing upgrade — except `viewResume`, which
 * per the pricing doc is NOT scoped to "candidates who applied" for Flex (only
 * `viewDocumentWallet` carries that restriction), so it also unlocks whenever
 * the recruiter has *any* currently-active Flex listing, not just this job's.
 */
export function getRecruiterFeatureAccess(params: {
  recruiterTier: string | null | undefined;
  job?: RecruiterListingLike | null;
  /** Does this recruiter have an active Flex listing on ANY job (not just `job`)? */
  hasAnyActiveFlexListing?: boolean;
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
  const anyFlexActive =
    Boolean(params.hasAnyActiveFlexListing) || jobFlexActive;

  return {
    unlimitedApplications: jobFlexActive,
    smartMatching: jobFlexActive,
    inviteCandidates: jobFlexActive,
    viewResume: anyFlexActive,
    viewDocumentWallet: jobFlexActive,
    directMessagingBeforeApplication: false,
    csvExport: false,
    premiumBadge: false,
    priorityListing: false,
  };
}
