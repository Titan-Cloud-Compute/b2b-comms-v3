-- Auth-only migration (Foundation: auth). Touches ONLY the "User" table.
-- display_name / organization_id were added nullable by 0006; make sure they exist
-- and harden "active" so login can refuse deactivated users.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "display_name" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "organization_id" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "active" BOOLEAN;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP(3);

UPDATE "User" SET "active" = true WHERE "active" IS NULL;
ALTER TABLE "User" ALTER COLUMN "active" SET DEFAULT true;
ALTER TABLE "User" ALTER COLUMN "active" SET NOT NULL;

UPDATE "User" SET "created_at" = "createdAt" WHERE "created_at" IS NULL;
ALTER TABLE "User" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;
