-- Store recruiter account preferences (notifications, etc.) separately from KYC JSON.
ALTER TABLE "Recruiter" ADD COLUMN IF NOT EXISTS "accountSettings" JSONB;
