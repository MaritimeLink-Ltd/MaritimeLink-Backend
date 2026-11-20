-- Optional job titles for admin team members and their invitations.
ALTER TABLE "admins" ADD COLUMN IF NOT EXISTS "title" TEXT;
ALTER TABLE "admin_invitations" ADD COLUMN IF NOT EXISTS "title" TEXT;
