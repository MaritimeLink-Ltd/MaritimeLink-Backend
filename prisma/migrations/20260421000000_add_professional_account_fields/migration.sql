ALTER TABLE "Professional"
ADD COLUMN IF NOT EXISTS "availableForWork" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Professional"
ADD COLUMN IF NOT EXISTS "membershipUpdatedAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "professional_feedback" (
  "id" TEXT NOT NULL,
  "professionalId" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "professional_feedback_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'professional_feedback_professionalId_fkey'
  ) THEN
    ALTER TABLE "professional_feedback"
    ADD CONSTRAINT "professional_feedback_professionalId_fkey"
    FOREIGN KEY ("professionalId") REFERENCES "Professional"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
