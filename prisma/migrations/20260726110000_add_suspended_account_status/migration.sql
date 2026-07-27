-- Additive enum values. Kept in their own migration: Postgres forbids using a new
-- enum value in the same transaction that adds it.
ALTER TYPE "ProfessionalStatus" ADD VALUE IF NOT EXISTS 'SUSPENDED';
ALTER TYPE "RecruiterStatus" ADD VALUE IF NOT EXISTS 'SUSPENDED';
