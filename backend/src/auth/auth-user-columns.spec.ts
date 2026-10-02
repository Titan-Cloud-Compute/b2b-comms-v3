import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../../');

function readSchema(): string {
  return fs.readFileSync(path.join(ROOT, 'prisma/schema.prisma'), 'utf-8');
}

function findMigrationDir(): string {
  const migrationsRoot = path.join(ROOT, 'prisma/migrations');
  const dirs = fs.readdirSync(migrationsRoot);
  const match = dirs.find((d) => /^\d{4}_auth_user_columns$/.test(d));
  if (!match) {
    throw new Error('Could not find a migration directory matching /^\\d{4}_auth_user_columns$/');
  }
  return path.join(migrationsRoot, match, 'migration.sql');
}

function readMigration(): string {
  return fs.readFileSync(findMigrationDir(), 'utf-8');
}

describe('User model — auth columns in schema.prisma', () => {
  let schema: string;

  beforeAll(() => {
    schema = readSchema();
  });

  it('declares displayName mapped to display_name', () => {
    expect(schema).toMatch(/displayName\s+String\??\s+@map\(["']display_name["']\)/);
  });

  it('declares organizationId mapped to organization_id', () => {
    expect(schema).toMatch(/organizationId\s+String\??\s+@map\(["']organization_id["']\)/);
  });

  it('declares active with @default(true)', () => {
    expect(schema).toMatch(/active\s+Boolean\s+@default\(true\)/);
  });
});

describe('Migration 0007_auth_user_columns', () => {
  let sql: string;

  beforeAll(() => {
    sql = readMigration();
  });

  it('adds display_name column', () => {
    expect(sql).toContain('"display_name"');
  });

  it('adds organization_id column', () => {
    expect(sql).toContain('"organization_id"');
  });

  it('adds active column', () => {
    expect(sql).toContain('"active"');
  });

  it('uses IF NOT EXISTS for every ADD COLUMN', () => {
    const addColumnLines = sql
      .split('\n')
      .filter((l) => /ADD\s+COLUMN/i.test(l));
    expect(addColumnLines.length).toBeGreaterThan(0);
    for (const line of addColumnLines) {
      expect(line.toUpperCase()).toContain('IF NOT EXISTS');
    }
  });

  it('only touches the "User" table (no ALTER TABLE or UPDATE for other tables)', () => {
    const alterLines = sql
      .split('\n')
      .filter((l) => /ALTER\s+TABLE|^\s*UPDATE\s/i.test(l));
    for (const line of alterLines) {
      expect(line).toMatch(/"User"/);
    }
  });
});
