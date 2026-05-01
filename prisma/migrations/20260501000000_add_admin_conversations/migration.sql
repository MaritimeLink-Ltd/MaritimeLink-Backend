ALTER TABLE "conversations"
ADD COLUMN IF NOT EXISTS "adminId" TEXT;

ALTER TABLE "conversations"
ALTER COLUMN "recruiterId" DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'conversations_adminId_fkey'
  ) THEN
    ALTER TABLE "conversations"
    ADD CONSTRAINT "conversations_adminId_fkey"
    FOREIGN KEY ("adminId") REFERENCES "admins"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "conversations_professionalId_adminId_key"
ON "conversations"("professionalId", "adminId");

CREATE INDEX IF NOT EXISTS "conversations_adminId_idx"
ON "conversations"("adminId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'conversations_participant_owner_check'
  ) THEN
    ALTER TABLE "conversations"
    ADD CONSTRAINT "conversations_participant_owner_check"
    CHECK (
      ("recruiterId" IS NOT NULL AND "adminId" IS NULL)
      OR
      ("recruiterId" IS NULL AND "adminId" IS NOT NULL)
    );
  END IF;
END $$;
