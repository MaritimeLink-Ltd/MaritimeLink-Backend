/**
 * True when the ID document(s) and selfie are present (submission ready for review).
 * PASSPORT only requires a front image; other document types require front and back.
 */
export function isKycPackComplete(
  kyc: {
    documentType?: string | null;
    documentFrontUrl?: string | null;
    documentBackUrl?: string | null;
    documentUrl?: string | null;
    selfieUrl?: string | null;
  } | null,
): boolean {
  if (!kyc?.selfieUrl) return false;

  const frontUrl = kyc.documentFrontUrl || kyc.documentUrl;
  if (!frontUrl) return false;

  if (kyc.documentType === 'PASSPORT') return true;

  return Boolean(kyc.documentBackUrl);
}
