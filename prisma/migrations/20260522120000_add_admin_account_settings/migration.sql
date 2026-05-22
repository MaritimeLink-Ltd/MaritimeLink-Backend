-- Admin profile preferences (display name, platform context, etc.)
ALTER TABLE "admins" ADD COLUMN IF NOT EXISTS "accountSettings" JSONB;
