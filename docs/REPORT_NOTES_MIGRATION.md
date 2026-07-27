# Internal admin notes on reports — database migration

Schema needed by the internal notes thread on the admin report review screen
(multiple admins leaving attributed notes while a report is still open).

Everything below is **additive**: one new table plus its indexes and foreign
keys. No existing column, row, table, enum, or constraint is modified or
dropped, and `user_reports.resolutionNote` keeps working exactly as before.

Safe to run in a single step — no new enum values are involved, so there is no
transaction restriction like the moderation migration had.

Idempotent — re-running it is harmless.

---

## Run it

```sql
CREATE TABLE IF NOT EXISTS "report_notes" (
  "id"         TEXT NOT NULL,
  "reportId"   TEXT NOT NULL,
  "adminId"    TEXT,
  "adminEmail" TEXT,
  "content"    TEXT NOT NULL,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "report_notes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "report_notes_reportId_idx"  ON "report_notes"("reportId");
CREATE INDEX IF NOT EXISTS "report_notes_createdAt_idx" ON "report_notes"("createdAt");

DO $$ BEGIN
  ALTER TABLE "report_notes"
    ADD CONSTRAINT "report_notes_reportId_fkey"
    FOREIGN KEY ("reportId") REFERENCES "user_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "report_notes"
    ADD CONSTRAINT "report_notes_adminId_fkey"
    FOREIGN KEY ("adminId") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
```

---

## Verify

```sql
SELECT count(*) FROM "report_notes";   -- expect 0, not an error

SELECT column_name FROM information_schema.columns
WHERE table_name = 'report_notes' ORDER BY ordinal_position;
-- expect id, reportId, adminId, adminEmail, content, createdAt
```

---

## Notes on the design

- `adminEmail` is **denormalised on purpose**. `adminId` is the real foreign key,
  but it is `ON DELETE SET NULL` — if an admin account is later removed, the note
  and the email of whoever wrote it survive, so the audit trail stays intact.
- Deleting a report cascades to its notes (`ON DELETE CASCADE`), so no orphans.
- Notes are **admin-only**. They are never returned by any professional- or
  recruiter-facing endpoint; only `GET /api/admin/reports/:id` includes them.

## Alternative

`npx prisma db push` from `Maritime-apis/` applies the same change, and
`npm run build` already runs it, so a deploy handles this on its own. Prefer the
SQL above when applying by hand — `db push` syncs the whole schema and can drop
drifted columns.
