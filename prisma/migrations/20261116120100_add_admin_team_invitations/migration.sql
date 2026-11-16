-- Admin team management: invitations, and removing a team member without
-- deleting their row (it is referenced by jobs, courses and support threads).

ALTER TABLE "admins" ADD COLUMN "disabledAt" TIMESTAMP(3),
ADD COLUMN "lastLoginAt" TIMESTAMP(3);

CREATE TABLE "admin_invitations" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "AdminRole" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "invitedById" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "admin_invitations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "admin_invitations_tokenHash_key" ON "admin_invitations"("tokenHash");
CREATE INDEX "admin_invitations_email_idx" ON "admin_invitations"("email");

ALTER TABLE "admin_invitations" ADD CONSTRAINT "admin_invitations_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;
