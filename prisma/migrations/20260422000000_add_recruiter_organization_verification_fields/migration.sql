ALTER TABLE "Recruiter"
ADD COLUMN IF NOT EXISTS "organizationRiskLevel" "KycRiskLevel";

ALTER TABLE "Recruiter"
ADD COLUMN IF NOT EXISTS "organizationVerificationData" JSONB;

ALTER TABLE "Recruiter"
ADD COLUMN IF NOT EXISTS "organizationVerificationDecision" TEXT;

ALTER TABLE "Recruiter"
ADD COLUMN IF NOT EXISTS "organizationVerificationSelectedAt" TIMESTAMP(3);

ALTER TABLE "Recruiter"
ADD COLUMN IF NOT EXISTS "organizationVerificationSource" TEXT;

ALTER TABLE "Recruiter"
ADD COLUMN IF NOT EXISTS "organizationVerified" BOOLEAN;
