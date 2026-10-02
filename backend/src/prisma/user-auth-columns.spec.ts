/**
 * Foundation: auth — the auth User table carries organization_id and a
 * non-null `active` flag (default true), and new user ids are uuids.
 * Static checks over schema.prisma + the auth-only migration.
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const PRISMA_DIR = join(__dirname, '..', '..', 'prisma');
const schema = readFileSync(join(PRISMA_DIR, 'schema.prisma'), 'utf8');

function userModel(): string {
  const m = schema.match(/model User \{([\s\S]*?)\n\}/);
  if (!m) throw new Error('model User not found in schema.prisma');
  return m[1];
}

describe('auth User table columns', () => {
  const body = userModel();

  it('new user ids default to uuid()', () => {
    expect(body).toMatch(/\bid\s+String\s+@id\s+@default\(uuid\(\)\)/);
  });

  it('has organization_id', () => {
    expect(body).toMatch(/\borganization_id\s+String\??/);
  });

  it('has a non-null active flag defaulting to true', () => {
    expect(body).toMatch(/\bactive\s+Boolean\s+@default\(true\)/);
  });

  it('has display_name', () => {
    expect(body).toMatch(/\bdisplay_name\s+String\??/);
  });

  it('ships an auth-only migration hardening "active" on the User table', () => {
    const dir = readdirSync(join(PRISMA_DIR, 'migrations')).find((d) => /_user_auth_columns$/.test(d));
    expect(dir).toBeDefined();
    const sql = readFileSync(join(PRISMA_DIR, 'migrations', dir!, 'migration.sql'), 'utf8');
    expect(sql).toMatch(/ALTER TABLE "User" ALTER COLUMN "active" SET DEFAULT true/);
    expect(sql).toMatch(/ALTER TABLE "User" ALTER COLUMN "active" SET NOT NULL/);
    expect(sql).toMatch(/"organization_id"/);
    // Auth-only: never creates domain tables.
    expect(sql).not.toMatch(/CREATE TABLE/i);
  });
});
