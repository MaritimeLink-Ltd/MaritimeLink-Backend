# Account moderation + user reports — database migration

Schema needed by the admin moderation feature (suspend / reinstate / block) and
the member-to-member reporting system.

Everything below is **additive**: new nullable columns, two new enum values, and
one new table. No existing column, row, or constraint is modified or dropped.

## Run it in two steps

Postgres will not let you *use* an enum value in the same transaction that adds
it, and the Supabase SQL editor wraps a submission in a transaction. So run
**Step 1 on its own, wait for it to finish, then run Step 2.**

Running Step 2 before Step 1 fails with `type "ProfessionalStatus" ... unsafe use
of new value 'SUSPENDED'`.

Both steps are idempotent — re-running them is harmless.

---

## Step 1 — new account statuses

```sql
ALTER TYPE "ProfessionalStatus" ADD VALUE IF NOT EXISTS 'SUSPENDED';
ALTER TYPE "RecruiterStatus"    ADD VALUE IF NOT EXISTS 'SUSPENDED';
```

---

## Step 2 — moderation columns, report enums, reports table

```sql
-- 1. Moderation bookkeeping on both account tables.
ALTER TABLE "Professional"
  ADD COLUMN IF NOT EXISTS "suspendedAt"            TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "suspendedUntil"         TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "suspensionReason"       TEXT,
  ADD COLUMN IF NOT EXISTS "suspendedById"          TEXT,
  ADD COLUMN IF NOT EXISTS "statusBeforeSuspension" "ProfessionalStatus";

ALTER TABLE "Recruiter"
  ADD COLUMN IF NOT EXISTS "suspendedAt"            TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "suspendedUntil"         TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "suspensionReason"       TEXT,
  ADD COLUMN IF NOT EXISTS "suspendedById"          TEXT,
  ADD COLUMN IF NOT EXISTS "statusBeforeSuspension" "RecruiterStatus";

-- 2. Reporting enums.
DO $$ BEGIN
  CREATE TYPE "ReportReason" AS ENUM ('SCAM_OR_FRAUD', 'HARASSMENT_OR_ABUSE', 'FAKE_ACCOUNT', 'INAPPROPRIATE_CONTENT', 'SPAM', 'PAYMENT_ISSUE', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "ReportStatus" AS ENUM ('PENDING', 'UNDER_REVIEW', 'ACTIONED', 'DISMISSED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "ReportAction" AS ENUM ('NONE', 'WARNING_ISSUED', 'ACCOUNT_SUSPENDED', 'ACCOUNT_BLOCKED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3. Reports table.
CREATE TABLE IF NOT EXISTS "user_reports" (
  "id"             TEXT NOT NULL,
  "reference"      TEXT NOT NULL,
  "reporterId"     TEXT NOT NULL,
  "reporterType"   "ActorType" NOT NULL,
  "reporterEmail"  TEXT,
  "reporterName"   TEXT,
  "reportedId"     TEXT NOT NULL,
  "reportedType"   "ActorType" NOT NULL,
  "reportedEmail"  TEXT,
  "reportedName"   TEXT,
  "reason"         "ReportReason" NOT NULL,
  "details"        TEXT NOT NULL,
  "conversationId" TEXT,
  "status"         "ReportStatus" NOT NULL DEFAULT 'PENDING',
  "actionTaken"    "ReportAction" NOT NULL DEFAULT 'NONE',
  "resolutionNote" TEXT,
  "reviewedById"   TEXT,
  "reviewedAt"     TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "user_reports_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "user_reports_reference_key"   ON "user_reports"("reference");
CREATE INDEX        IF NOT EXISTS "user_reports_status_idx"      ON "user_reports"("status");
CREATE INDEX        IF NOT EXISTS "user_reports_reportedId_idx"  ON "user_reports"("reportedId");
CREATE INDEX        IF NOT EXISTS "user_reports_reporterId_idx"  ON "user_reports"("reporterId");
CREATE INDEX        IF NOT EXISTS "user_reports_createdAt_idx"   ON "user_reports"("createdAt");

DO $$ BEGIN
  ALTER TABLE "user_reports"
    ADD CONSTRAINT "user_reports_reviewedById_fkey"
    FOREIGN KEY ("reviewedById") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
```

---

## Verify

```sql
SELECT unnest(enum_range(NULL::"ProfessionalStatus"));  -- expect SUSPENDED in the list
SELECT count(*) FROM "user_reports";                    -- expect 0, not an error

SELECT column_name FROM information_schema.columns
WHERE table_name = 'Recruiter' AND column_name LIKE 'suspend%';
-- expect suspendedAt, suspendedUntil, suspensionReason, suspendedById
```

## Alternative

`npx prisma db push` from `Maritime-apis/` applies exactly the same change, and
`npm run build` already runs it — so a deploy handles this on its own. The SQL
above is here for when you want to apply it by hand first.

Equivalent migration files (used if the project ever switches to
`prisma migrate deploy`) live at:

- `prisma/migrations/20260726110000_add_suspended_account_status/`
- `prisma/migrations/20260726120000_add_account_moderation_and_user_reports/`
