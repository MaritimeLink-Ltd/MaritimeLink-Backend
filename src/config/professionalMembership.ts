/**
 * Professionals use MaritimeLink free of charge for now — a client decision
 * (Oct 2026) for marketing, planned for one to two years. Recruiters and
 * training providers are unaffected.
 *
 * Every professional is created on the PRO tier, and a paid subscription
 * that ends leaves them on PRO instead of dropping them to FREE. Nothing
 * else changes: the subscription code and every premium check stay as they
 * are, so setting this to false restores paid membership exactly as before
 * (existing accounts would then need moving back to FREE).
 */
export const PROFESSIONALS_FREE_PRO = true;

/** Tier for a new professional account. */
export const newProfessionalTier = (): 'FREE' | 'PRO' =>
  PROFESSIONALS_FREE_PRO ? 'PRO' : 'FREE';

/** Tier a professional falls back to when a paid subscription ends. */
export const lapsedProfessionalTier = (): 'FREE' | 'PRO' =>
  PROFESSIONALS_FREE_PRO ? 'PRO' : 'FREE';
