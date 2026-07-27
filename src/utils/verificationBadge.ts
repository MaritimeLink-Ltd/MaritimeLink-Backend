/**
 * Single source of truth for the professional verification badge.
 *
 * The badge requires BOTH review stages to have passed:
 *   Stage 1 — account review  (`Professional.status` === VERIFIED)
 *   Stage 2 — KYC identity check (`ProfessionalKyc.status` === APPROVED)
 *
 * Requiring Stage 1 as well means a professional who is later suspended, blocked or
 * reverted to PENDING immediately stops displaying the badge, even though their KYC
 * record still reads APPROVED.
 *
 * `Professional.isVerified` is deliberately NOT consulted — that flag only means the
 * email OTP was confirmed at registration and carries no identity assurance.
 */

/** Stage 1 account states that count as approved. */
const APPROVED_ACCOUNT_STATUSES = new Set(['VERIFIED', 'APPROVED', 'ACTIVE']);

export const isIdentityVerified = (professional: {
  status?: string | null;
  kyc?: { status?: string | null } | null;
}): boolean => {
  const stage1 = APPROVED_ACCOUNT_STATUSES.has(
    String(professional?.status || '')
      .trim()
      .toUpperCase(),
  );
  const stage2 =
    String(professional?.kyc?.status || '')
      .trim()
      .toUpperCase() === 'APPROVED';

  return stage1 && stage2;
};
