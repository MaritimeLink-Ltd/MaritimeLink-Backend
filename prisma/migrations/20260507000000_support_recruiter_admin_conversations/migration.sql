ALTER TABLE "conversations"
ALTER COLUMN "professionalId" DROP NOT NULL;

DROP INDEX IF EXISTS "conversations_recruiterId_adminId_key";

CREATE UNIQUE INDEX IF NOT EXISTS "conversations_recruiterId_adminId_key"
ON "conversations"("recruiterId", "adminId");

ALTER TABLE "conversations"
DROP CONSTRAINT IF EXISTS "conversations_participant_owner_check";

ALTER TABLE "conversations"
ADD CONSTRAINT "conversations_participant_owner_check"
CHECK (
  (
    "professionalId" IS NOT NULL
    AND (
      ("recruiterId" IS NOT NULL AND "adminId" IS NULL)
      OR
      ("recruiterId" IS NULL AND "adminId" IS NOT NULL)
    )
  )
  OR
  (
    "professionalId" IS NULL
    AND "recruiterId" IS NOT NULL
    AND "adminId" IS NOT NULL
  )
);
