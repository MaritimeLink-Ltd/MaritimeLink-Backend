/** True when ID front/back and selfie are present (submission ready for review). */
export function isKycPackComplete(
  kyc: {
    documentFrontUrl?: string | null;
    documentBackUrl?: string | null;
    documentUrl?: string | null;
    selfieUrl?: string | null;
  } | null,
): boolean {
  if (!kyc?.selfieUrl) return false;
  const hasId =
    Boolean(kyc.documentFrontUrl && kyc.documentBackUrl) ||
    Boolean(kyc.documentUrl);
  return hasId;
}
