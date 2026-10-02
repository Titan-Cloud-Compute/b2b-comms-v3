-- Idempotent forward migration: add display_name, organization_id, active to User.
-- Uses IF NOT EXISTS so it is safe to replay on databases that already have these
-- columns from a parallel lineage (0006_spec_data_model).

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "display_name" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "organization_id" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "active" BOOLEAN NOT NULL DEFAULT true;
