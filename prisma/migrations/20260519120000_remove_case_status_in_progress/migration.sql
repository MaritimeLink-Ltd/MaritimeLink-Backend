-- Reclassify unused IN_PROGRESS cases as OPEN before shrinking the enum.
UPDATE "support_cases" SET "status" = 'OPEN' WHERE "status" = 'IN_PROGRESS';

ALTER TYPE "CaseStatus" RENAME TO "CaseStatus_old";
CREATE TYPE "CaseStatus" AS ENUM ('OPEN', 'RESOLVED', 'CLOSED');
ALTER TABLE "support_cases" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "support_cases"
  ALTER COLUMN "status" TYPE "CaseStatus"
  USING ("status"::text::"CaseStatus");
ALTER TABLE "support_cases" ALTER COLUMN "status" SET DEFAULT 'OPEN';
DROP TYPE "CaseStatus_old";
