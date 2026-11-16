-- Additive enum value. Kept in its own migration: Postgres forbids using a new
-- enum value in the same transaction that adds it.
ALTER TYPE "AdminRole" ADD VALUE IF NOT EXISTS 'OPERATIONS_MANAGER';
