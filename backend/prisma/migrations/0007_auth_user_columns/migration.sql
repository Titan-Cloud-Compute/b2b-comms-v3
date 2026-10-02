-- AlterTable: add display_name, organization_id, active to User (idempotent)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "display_name" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "organization_id" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "active" BOOLEAN NOT NULL DEFAULT true;
