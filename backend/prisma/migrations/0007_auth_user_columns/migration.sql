-- Auth foundation (full_auth): the auth User table carries the shared data
-- model's identity columns. Idempotent forward migration — safe on databases
-- where 0006 already added them and on lineages where it did not.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "display_name" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "organization_id" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "active" BOOLEAN;

-- Existing accounts stay active; new accounts default to active.
UPDATE "User" SET "active" = true WHERE "active" IS NULL;
ALTER TABLE "User" ALTER COLUMN "active" SET DEFAULT true;
