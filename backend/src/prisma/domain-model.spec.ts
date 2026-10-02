/**
 * Domain model guard: schema.prisma declares every spec table with the exact
 * columns, keys and relations, and the template User carries the spec columns.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const SCHEMA = readFileSync(join(__dirname, '..', '..', 'prisma', 'schema.prisma'), 'utf8');

/** Return the body of `model <name> { ... }`. */
function modelBody(name: string): string {
  const m = SCHEMA.match(new RegExp(`\\nmodel ${name} \\{([\\s\\S]*?)\\n\\}`));
  if (!m) throw new Error(`model ${name} not found`);
  return m[1];
}

/** Map field name -> rest of the declaration line (type + attributes). */
function fields(name: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const raw of modelBody(name).split('\n')) {
    const line = raw.replace(/\/\/.*$/, '').trim();
    if (!line || line.startsWith('@@')) continue;
    const [field, ...rest] = line.split(/\s+/);
    out.set(field, rest.join(' '));
  }
  return out;
}

const SPEC: Record<string, string[]> = {
  organizations: ['id', 'name', 'type', 'is_internal', 'created_at'],
  invitations: ['id', 'project_id', 'email', 'token_hash', 'status', 'invited_by', 'expires_at'],
  projects: ['id', 'organization_id', 'name', 'status', 'created_by', 'created_at'],
  project_members: ['project_id', 'user_id', 'added_at'],
  folders: ['id', 'project_id', 'parent_id', 'name', 'created_by', 'deleted_at'],
  files: ['id', 'project_id', 'folder_id', 'name', 'mime_type', 'current_version_id', 'deleted_at'],
  file_versions: ['id', 'file_id', 'version_number', 'storage_key', 'size_bytes', 'uploaded_by', 'uploaded_at'],
  channels: ['id', 'project_id', 'kind', 'name', 'internal_only', 'status', 'created_by', 'created_at'],
  question_resolutions: ['channel_id', 'side', 'resolved_by', 'resolved_at'],
  messages: ['id', 'channel_id', 'author_id', 'body_html', 'edited_at', 'deleted_at', 'created_at'],
  message_attachments: ['id', 'message_id', 'file_id'],
  references: ['id', 'message_id', 'file_version_id', 'page_number', 'annotations', 'author_id', 'updated_at'],
  channel_read_state: ['channel_id', 'user_id', 'last_read_message_id', 'unread_count'],
};

const SCALARS = /^(String|Int|BigInt|Boolean|DateTime|Json)\??$/;

describe('domain model (schema.prisma)', () => {
  it('does not declare a second users table', () => {
    expect(SCHEMA).not.toMatch(/\nmodel users \{/);
  });

  for (const [model, cols] of Object.entries(SPEC)) {
    it(`${model} has exactly the spec scalar columns`, () => {
      const scalar = [...fields(model).entries()]
        .filter(([, decl]) => SCALARS.test(decl.split(' ')[0]))
        .map(([f]) => f)
        .sort();
      expect(scalar).toEqual([...cols].sort());
    });
  }

  it('uses uuid ids for every model with an id column', () => {
    for (const [model, cols] of Object.entries(SPEC)) {
      if (!cols.includes('id')) continue;
      expect(fields(model).get('id')).toMatch(/@id @default\(uuid\(\)\) @db\.Uuid/);
    }
  });

  it('declares composite primary keys and uniques', () => {
    expect(modelBody('project_members')).toMatch(/@@id\(\[project_id, user_id\]\)/);
    expect(modelBody('question_resolutions')).toMatch(/@@id\(\[channel_id, side\]\)/);
    expect(modelBody('channel_read_state')).toMatch(/@@id\(\[channel_id, user_id\]\)/);
    expect(fields('references').get('message_id')).toMatch(/@unique/);
    expect(modelBody('file_versions')).toMatch(/@@unique\(\[file_id, version_number\]\)/);
  });

  it('uses the spec column types', () => {
    expect(fields('file_versions').get('size_bytes')).toMatch(/^BigInt\b/);
    expect(fields('references').get('annotations')).toMatch(/^Json\b.*@db\.JsonB/);
    expect(fields('file_versions').get('version_number')).toMatch(/^Int\b/);
    expect(fields('channel_read_state').get('unread_count')).toMatch(/^Int\b/);
  });

  it('keeps only the intended columns nullable', () => {
    const nullable: Record<string, string[]> = {
      folders: ['parent_id', 'deleted_at'],
      files: ['folder_id', 'current_version_id', 'deleted_at'],
      messages: ['edited_at', 'deleted_at'],
      references: ['page_number'],
      channel_read_state: ['last_read_message_id'],
    };
    for (const [model, cols] of Object.entries(SPEC)) {
      const f = fields(model);
      for (const c of cols) {
        const optional = /^\w+\?/.test(f.get(c) ?? '');
        expect({ model, c, optional }).toEqual({ model, c, optional: (nullable[model] ?? []).includes(c) });
      }
    }
  });

  it('declares the foreign-key relations', () => {
    const rel = (model: string, fk: string, target: string) =>
      expect(modelBody(model)).toMatch(
        new RegExp(`\\s${target}\\??\\s+@relation\\([^)]*fields: \\[${fk}\\], references: \\[id\\]`),
      );
    rel('projects', 'organization_id', 'organizations');
    for (const m of ['invitations', 'project_members', 'folders', 'files', 'channels']) rel(m, 'project_id', 'projects');
    rel('folders', 'parent_id', 'folders');
    rel('files', 'folder_id', 'folders');
    rel('files', 'current_version_id', 'file_versions');
    rel('file_versions', 'file_id', 'files');
    for (const m of ['question_resolutions', 'messages', 'channel_read_state']) rel(m, 'channel_id', 'channels');
    rel('message_attachments', 'message_id', 'messages');
    rel('message_attachments', 'file_id', 'files');
    rel('references', 'message_id', 'messages');
    rel('references', 'file_version_id', 'file_versions');
    rel('channel_read_state', 'last_read_message_id', 'messages');
    rel('invitations', 'invited_by', 'User');
    rel('projects', 'created_by', 'User');
    rel('project_members', 'user_id', 'User');
    rel('folders', 'created_by', 'User');
    rel('file_versions', 'uploaded_by', 'User');
    rel('channels', 'created_by', 'User');
    rel('question_resolutions', 'resolved_by', 'User');
    rel('messages', 'author_id', 'User');
    rel('references', 'author_id', 'User');
    rel('channel_read_state', 'user_id', 'User');
  });

  it('User carries display_name / organization_id / active / created_at', () => {
    const u = fields('User');
    expect(u.get('display_name')).toMatch(/^String/);
    expect(u.get('organization_id')).toMatch(/^String\?\s+@db\.Uuid/);
    expect(u.get('active')).toMatch(/^Boolean\s+@default\(true\)/);
    expect(u.get('created_at')).toMatch(/^DateTime\s+@default\(now\(\)\)/);
    expect(modelBody('User')).toMatch(/organizations\?\s+@relation\([^)]*fields: \[organization_id\], references: \[id\]/);
  });
});
