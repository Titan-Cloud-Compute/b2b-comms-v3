/**
 * Auth User columns guard.
 *
 * Asserts that:
 *  - schema.prisma's User model declares displayName, organizationId, and active
 *    with the correct @map names.
 *  - active has @default(true).
 *  - The 0007_auth_user_columns migration adds all three columns with IF NOT EXISTS.
 *  - Only the "User" table is touched by that migration.
 */

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const SCHEMA_PATH = join(__dirname, '..', '..', 'prisma', 'schema.prisma');
const MIGRATIONS_DIR = join(__dirname, '..', '..', 'prisma', 'migrations');

function schemaText(): string {
  return readFileSync(SCHEMA_PATH, 'utf8');
}

function migrationSql(): string {
  const migDir = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d{4}_auth_user_columns$/.test(d.name))
    .map((d) => d.name);

  expect(migDir.length).toBe(1);
  const sqlPath = join(MIGRATIONS_DIR, migDir[0], 'migration.sql');
  return readFileSync(sqlPath, 'utf8');
}

describe('User model columns in schema.prisma', () => {
  let schema: string;

  beforeAll(() => {
    schema = schemaText();
  });

  it('declares displayName mapped to display_name', () => {
    // Look for displayName with @map("display_name") inside the User model block
    const userBlock = schema.match(/model\s+User\s*\{[^}]+\}/s)?.[0] ?? '';
    expect(userBlock).toMatch(/displayName\s+String\??.*@map\("display_name"\)/);
  });

  it('declares organizationId mapped to organization_id', () => {
    const userBlock = schema.match(/model\s+User\s*\{[^}]+\}/s)?.[0] ?? '';
    expect(userBlock).toMatch(/organizationId\s+String\??.*@map\("organization_id"\)/);
  });

  it('declares active with @default(true)', () => {
    const userBlock = schema.match(/model\s+User\s*\{[^}]+\}/s)?.[0] ?? '';
    expect(userBlock).toMatch(/active\s+Boolean.*@default\(true\)/);
  });
});

describe('0007_auth_user_columns migration', () => {
  let sql: string;

  beforeAll(() => {
    sql = migrationSql();
  });

  it('adds display_name with IF NOT EXISTS', () => {
    expect(sql).toMatch(/ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+"display_name"/i);
  });

  it('adds organization_id with IF NOT EXISTS', () => {
    expect(sql).toMatch(/ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+"organization_id"/i);
  });

  it('adds active with IF NOT EXISTS', () => {
    expect(sql).toMatch(/ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+"active"/i);
  });

  it('only touches the User table (no other ALTER TABLE or UPDATE)', () => {
    // Strip comments
    const stripped = sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const tables = [...stripped.matchAll(/(?:ALTER\s+TABLE|UPDATE)\s+"?(\w+)"?/gi)].map(
      (m) => m[1],
    );
    for (const t of tables) {
      expect(t).toBe('User');
    }
  });
});
