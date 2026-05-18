type KycLike = {
  status?: string | null;
  documentFrontUrl?: string | null;
  documentBackUrl?: string | null;
  documentUrl?: string | null;
  selfieUrl?: string | null;
  documentNumber?: string | null;
} | null;

const kycLoginSelectBase = {
  status: true,
  documentFrontUrl: true,
  documentBackUrl: true,
  selfieUrl: true,
  documentNumber: true,
} as const;

/** Recruiter KYC still has legacy documentUrl column */
export const recruiterKycLoginSelect = {
  ...kycLoginSelectBase,
  documentUrl: true,
} as const;

/** Professional KYC uses front/back URLs only (no documentUrl column) */
export const professionalKycLoginSelect = kycLoginSelectBase;

/** @deprecated Use recruiterKycLoginSelect or professionalKycLoginSelect */
export const kycLoginSelect = recruiterKycLoginSelect;

export function mapKycForLogin(kyc: KycLike) {
  if (!kyc) {
    return { kyc: null, kycSubmitted: false };
  }

  return {
    kyc: {
      status: kyc.status,
      documentFrontUrl: kyc.documentFrontUrl,
      documentBackUrl: kyc.documentBackUrl,
      documentUrl: kyc.documentUrl ?? kyc.documentFrontUrl ?? null,
      selfieUrl: kyc.selfieUrl,
      documentNumber: kyc.documentNumber,
    },
    kycSubmitted: true,
  };
}
