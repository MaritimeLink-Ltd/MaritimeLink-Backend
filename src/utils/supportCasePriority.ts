import { CasePriority } from '../generated/client/index.js';

/** Premium / paid professional tiers — HIGH priority support queue */
export function isPremiumProfessionalTier(tier: unknown): boolean {
  const t = String(tier ?? 'FREE')
    .trim()
    .toUpperCase();
  return t === 'PRO' || t === 'PREMIUM' || t === 'SUBSCRIBED';
}

/** User-created cases: recruiters/trainers → LOW; professionals → HIGH only if premium */
export function deriveUserSupportCasePriority(
  isStaffAccount: boolean,
  professionalTier: unknown,
): CasePriority {
  if (isStaffAccount) return CasePriority.LOW;
  return isPremiumProfessionalTier(professionalTier)
    ? CasePriority.HIGH
    : CasePriority.LOW;
}

/** Public API: only HIGH and LOW; legacy MEDIUM maps to LOW */
export function normalizeStoredCasePriority(p: unknown): CasePriority {
  const u = String(p ?? 'LOW').toUpperCase();
  if (u === 'HIGH') return CasePriority.HIGH;
  return CasePriority.LOW;
}
