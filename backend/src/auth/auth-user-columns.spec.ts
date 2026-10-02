/**
 * Auth foundation (full_auth): the auth User table carries display_name,
 * organization_id and active, added by an idempotent forward migration.
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const PRISMA_DIR = join(__dirname, '..', '..', 'prisma');
const schema = readFileSync(join(PRISMA_DIR, 'schema.prisma'), 'utf8');
const userModel = (schema.match(/^model User \{[\s\S]*?^\}/m) ?? [''])[0];
const migrationDir = readdirSync(join(PRISMA_DIR, 'migrations')).find((d) =>
  /^\d{4}_auth_user_columns$/.test(d),
);
const migrationSql = migrationDir
  ? readFileSync(join(PRISMA_DIR, 'migrations', migrationDir, 'migration.sql'), 'utf8')
  : '';

describe('auth User identity columns', () => {
  it.each(['display_name', 'organization_id', 'active'])('schema User declares %s', (col) => {
    expect(userModel).toMatch(new RegExp(`^\\s+${col}\\s`, 'm'));
  });

  it('active defaults to true so new accounts are not deactivated', () => {
    expect(userModel).toMatch(/^\s+active\s+Boolean\??\s+@default\(true\)/m);
  });

  it('a forward migration adds the columns', () => {
    expect(migrationDir).toBeDefined();
    for (const col of ['display_name', 'organization_id', 'active']) {
      expect(migrationSql).toContain(`"${col}"`);
    }
  });

  it('the migration is idempotent (every ADD COLUMN uses IF NOT EXISTS)', () => {
    const adds = migrationSql.match(/ADD COLUMN[^;]*/gi) ?? [];
    expect(adds.length).toBeGreaterThanOrEqual(3);
    for (const add of adds) expect(add).toMatch(/ADD COLUMN IF NOT EXISTS/i);
  });

  it('the migration touches only the auth User table', () => {
    const tables = [...migrationSql.matchAll(/(?:ALTER TABLE|UPDATE)\s+"(\w+)"/gi)].map((m) => m[1]);
    expect(new Set(tables)).toEqual(new Set(['User']));
  });
});
