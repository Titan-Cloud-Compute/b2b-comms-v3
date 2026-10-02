/**
 * Domain migration guard: a single forward migration (after the loose,
 * untouched 0006_spec_data_model) creates every spec table with its keys and
 * foreign keys and adds the User spec columns.
 */

import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'prisma', 'migrations');
const DOMAIN_MIGRATION = '0007_spec_data_model_strict';
const SQL = readFileSync(join(MIGRATIONS_DIR, DOMAIN_MIGRATION, 'migration.sql'), 'utf8');

const TABLES = [
  'organizations', 'invitations', 'projects', 'project_members', 'folders', 'files',
  'file_versions', 'channels', 'question_resolutions', 'messages', 'message_attachments',
  'references', 'channel_read_state',
];

function createBlock(table: string): string {
  const m = SQL.match(new RegExp(`CREATE TABLE "${table}" \\(([\\s\\S]*?)\\n\\);`));
  if (!m) throw new Error(`CREATE TABLE "${table}" not found`);
  return m[1];
}

const fk = (table: string, col: string, target: string) =>
  expect(SQL).toMatch(
    new RegExp(`ALTER TABLE "${table}" ADD CONSTRAINT "[^"]+" FOREIGN KEY \\("${col}"\\) REFERENCES "${target}"\\("id"\\)`),
  );

describe('domain migration', () => {
  it('domain migration exists after 0006 and the scaffold 0006 is kept', () => {
    const dirs = readdirSync(MIGRATIONS_DIR).filter((d) => /^\d{4}_/.test(d)).sort();
    expect(dirs).toContain('0006_spec_data_model');
    // Auth card also adds an auth-only migration after 0006; guard only that the
    // domain migration itself is present (not a strict "only one" check).
    expect(dirs.filter((d) => d > '0006_spec_data_model')).toContain(DOMAIN_MIGRATION);
  });

  it('creates every spec table and no users table', () => {
    for (const t of TABLES) expect(createBlock(t)).toBeTruthy();
    expect(SQL).not.toMatch(/CREATE TABLE "users"/);
  });

  it('uses uuid ids and drops the scaffold createdAt/updatedAt columns', () => {
    for (const t of TABLES) {
      const b = createBlock(t);
      if (/"id" /.test(b)) expect(b).toMatch(/"id" UUID NOT NULL/);
      expect(b).not.toMatch(/"createdAt"|"updatedAt"/);
    }
  });

  it('declares composite primary keys and unique constraints', () => {
    expect(createBlock('project_members')).toMatch(/PRIMARY KEY \("project_id","user_id"\)/);
    expect(createBlock('question_resolutions')).toMatch(/PRIMARY KEY \("channel_id","side"\)/);
    expect(createBlock('channel_read_state')).toMatch(/PRIMARY KEY \("channel_id","user_id"\)/);
    expect(SQL).toMatch(/CREATE UNIQUE INDEX "[^"]+" ON "references"\("message_id"\)/);
    expect(SQL).toMatch(/CREATE UNIQUE INDEX "[^"]+" ON "file_versions"\("file_id", "version_number"\)/);
  });

  it('uses the spec column types and nullability', () => {
    expect(createBlock('file_versions')).toMatch(/"size_bytes" BIGINT NOT NULL/);
    expect(createBlock('references')).toMatch(/"annotations" JSONB NOT NULL/);
    expect(createBlock('references')).toMatch(/"page_number" INTEGER,/);
    expect(createBlock('messages')).toMatch(/"body_html" TEXT NOT NULL/);
    expect(createBlock('files')).toMatch(/"folder_id" UUID,/);
  });

  it('adds every foreign key', () => {
    fk('projects', 'organization_id', 'organizations');
    for (const t of ['invitations', 'project_members', 'folders', 'files', 'channels']) fk(t, 'project_id', 'projects');
    fk('folders', 'parent_id', 'folders');
    fk('files', 'folder_id', 'folders');
    fk('files', 'current_version_id', 'file_versions');
    fk('file_versions', 'file_id', 'files');
    for (const t of ['question_resolutions', 'messages', 'channel_read_state']) fk(t, 'channel_id', 'channels');
    fk('message_attachments', 'message_id', 'messages');
    fk('message_attachments', 'file_id', 'files');
    fk('references', 'message_id', 'messages');
    fk('references', 'file_version_id', 'file_versions');
    fk('channel_read_state', 'last_read_message_id', 'messages');
    fk('invitations', 'invited_by', 'User');
    fk('projects', 'created_by', 'User');
    fk('project_members', 'user_id', 'User');
    fk('folders', 'created_by', 'User');
    fk('file_versions', 'uploaded_by', 'User');
    fk('channels', 'created_by', 'User');
    fk('question_resolutions', 'resolved_by', 'User');
    fk('messages', 'author_id', 'User');
    fk('references', 'author_id', 'User');
    fk('channel_read_state', 'user_id', 'User');
    fk('User', 'organization_id', 'organizations');
  });

  it('brings the User spec columns to usable shape', () => {
    expect(SQL).toMatch(/ALTER TABLE "User" ADD COLUMN "organization_id" UUID;/);
    expect(SQL).toMatch(/ALTER TABLE "User" ALTER COLUMN "active" SET DEFAULT true;/);
    expect(SQL).toMatch(/ALTER TABLE "User" ALTER COLUMN "active" SET NOT NULL;/);
    expect(SQL).toMatch(/ALTER TABLE "User" ALTER COLUMN "created_at" SET NOT NULL;/);
  });
});
