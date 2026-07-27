ALTER TABLE "Professional"
  ADD COLUMN IF NOT EXISTS "suspendedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "suspendedUntil" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "suspensionReason" TEXT,
  ADD COLUMN IF NOT EXISTS "suspendedById" TEXT,
  ADD COLUMN IF NOT EXISTS "statusBeforeSuspension" "ProfessionalStatus";

ALTER TABLE "Recruiter"
  ADD COLUMN IF NOT EXISTS "suspendedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "suspendedUntil" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "suspensionReason" TEXT,
  ADD COLUMN IF NOT EXISTS "suspendedById" TEXT,
  ADD COLUMN IF NOT EXISTS "statusBeforeSuspension" "RecruiterStatus";

DO $$ BEGIN
  CREATE TYPE "ReportReason" AS ENUM ('SCAM_OR_FRAUD', 'HARASSMENT_OR_ABUSE', 'FAKE_ACCOUNT', 'INAPPROPRIATE_CONTENT', 'SPAM', 'PAYMENT_ISSUE', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "ReportStatus" AS ENUM ('PENDING', 'UNDER_REVIEW', 'ACTIONED', 'DISMISSED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "ReportAction" AS ENUM ('NONE', 'WARNING_ISSUED', 'ACCOUNT_SUSPENDED', 'ACCOUNT_BLOCKED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "user_reports" (
  "id" TEXT NOT NULL,
  "reference" TEXT NOT NULL,
  "reporterId" TEXT NOT NULL,
  "reporterType" "ActorType" NOT NULL,
  "reporterEmail" TEXT,
  "reporterName" TEXT,
  "reportedId" TEXT NOT NULL,
  "reportedType" "ActorType" NOT NULL,
  "reportedEmail" TEXT,
  "reportedName" TEXT,
  "reason" "ReportReason" NOT NULL,
  "details" TEXT NOT NULL,
  "conversationId" TEXT,
  "status" "ReportStatus" NOT NULL DEFAULT 'PENDING',
  "actionTaken" "ReportAction" NOT NULL DEFAULT 'NONE',
  "resolutionNote" TEXT,
  "reviewedById" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "user_reports_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "user_reports_reference_key" ON "user_reports"("reference");
CREATE INDEX IF NOT EXISTS "user_reports_status_idx" ON "user_reports"("status");
CREATE INDEX IF NOT EXISTS "user_reports_reportedId_idx" ON "user_reports"("reportedId");
CREATE INDEX IF NOT EXISTS "user_reports_reporterId_idx" ON "user_reports"("reporterId");
CREATE INDEX IF NOT EXISTS "user_reports_createdAt_idx" ON "user_reports"("createdAt");

DO $$ BEGIN
  ALTER TABLE "user_reports"
    ADD CONSTRAINT "user_reports_reviewedById_fkey"
    FOREIGN KEY ("reviewedById") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
