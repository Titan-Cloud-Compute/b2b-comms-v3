-- Auth user profile: display name, organization and active flag.
-- IF NOT EXISTS: 0006 may already have added these on some lineages.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "display_name" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "organization_id" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "active" BOOLEAN;
ALTER TABLE "User" ALTER COLUMN "active" SET DEFAULT true;
UPDATE "User" SET "active" = true WHERE "active" IS NULL;
