import { prisma } from '../config/prisma.js';
import { KycRiskLevel, VerificationStatus } from '../generated/client/index.js';

/** Align with Accounts list: document mismatches elevate risk to HIGH. */
export function resolveProfessionalRiskLevel(
  kyc:
    | {
        riskLevel?: KycRiskLevel | null;
        mismatchDetected?: boolean | null;
      }
    | null
    | undefined,
  mismatchDocCount = 0,
): KycRiskLevel {
  if (mismatchDocCount > 0 || kyc?.mismatchDetected) {
    return KycRiskLevel.HIGH;
  }

  return kyc?.riskLevel ?? KycRiskLevel.LOW;
}

export function resolveRecruiterRiskLevel(recruiter: {
  organizationRiskLevel?: KycRiskLevel | null;
  organizationVerified?: boolean | null;
  kyc: {
    riskLevel?: KycRiskLevel | null;
    mismatchDetected?: boolean | null;
  } | null;
}): KycRiskLevel {
  if (
    recruiter.kyc?.riskLevel === KycRiskLevel.HIGH ||
    recruiter.organizationRiskLevel === KycRiskLevel.HIGH ||
    recruiter.kyc?.mismatchDetected ||
    recruiter.organizationVerified === false
  ) {
    return KycRiskLevel.HIGH;
  }

  return (
    recruiter.kyc?.riskLevel ??
    recruiter.organizationRiskLevel ??
    KycRiskLevel.LOW
  );
}

export async function countMismatchDocumentsByProfessionalIds(
  professionalIds: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (professionalIds.length === 0) return counts;

  const rows = await prisma.professionalDocument.groupBy({
    by: ['professionalId'],
    where: {
      professionalId: { in: professionalIds },
      verificationStatus: VerificationStatus.MISMATCH,
    },
    _count: { id: true },
  });

  for (const row of rows) {
    counts.set(row.professionalId, row._count.id);
  }

  return counts;
}
