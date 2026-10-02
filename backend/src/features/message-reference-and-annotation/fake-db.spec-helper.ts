/**
 * In-memory Prisma stand-in + Nest test app for the Message Reference and
 * Annotation HTTP specs. Identify the caller with the `x-test-user` header.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { json } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { MinioService } from '../../lib/integrations/minio.service';
import { ReferencesController } from './references.controller';
import { ReferencesService } from './references.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([k, cond]) => {
    if (cond && typeof cond === 'object' && !(cond instanceof Date) && 'in' in cond) {
      return (cond.in as unknown[]).includes(row[k]);
    }
    if (cond === null) return row[k] == null;
    return row[k] === cond;
  });
}

export class Table {
  rows: Row[] = [];
  private seq = 0;
  constructor(private readonly prefix: string) {}
  async findMany(args: { where?: Row } = {}) {
    return this.rows.filter((r) => matches(r, args.where));
  }
  async findUnique(args: { where: Row }) {
    return this.rows.find((r) => matches(r, args.where)) ?? null;
  }
  async findFirst(args: { where?: Row } = {}) {
    return this.rows.find((r) => matches(r, args.where)) ?? null;
  }
  async create(args: { data: Row }) {
    const row = { id: `${this.prefix}${String(++this.seq).padStart(4, '0')}`, ...args.data };
    this.rows.push(row);
    return row;
  }
  async update(args: { where: Row; data: Row }) {
    const row = this.rows.find((r) => matches(r, args.where));
    if (!row) throw new Error('record not found');
    Object.assign(row, args.data);
    return row;
  }
  async deleteMany(args: { where?: Row } = {}) {
    const before = this.rows.length;
    this.rows = this.rows.filter((r) => !matches(r, args.where));
    return { count: before - this.rows.length };
  }
}

export function makeDb() {
  const tx = {
    user: new Table('u'),
    organizations: new Table('org'),
    projects: new Table('p'),
    project_members: new Table('pm'),
    channels: new Table('ch'),
    messages: new Table('m'),
    files: new Table('f'),
    file_versions: new Table('fv'),
    references: new Table('ref'),
  };
  tx.organizations.rows.push({ id: 'org-ext', name: 'Globex', is_internal: false });
  tx.user.rows.push(
    { id: 'author', email: 'a@x', role: 'USER', organizationId: null },
    { id: 'viewer', email: 'v@x', role: 'USER', organizationId: null },
    { id: 'external', email: 'e@x', role: 'USER', organizationId: 'org-ext' },
    { id: 'outsider', email: 'o@x', role: 'USER', organizationId: null },
  );
  tx.projects.rows.push({ id: 'p1', organization_id: 'org-ext', name: 'Globex', status: 'active' });
  for (const u of ['author', 'viewer', 'external']) tx.project_members.rows.push({ project_id: 'p1', user_id: u });
  tx.channels.rows.push({ id: 'c1', project_id: 'p1', kind: 'general', name: 'general', internal_only: false });
  tx.messages.rows.push(
    { id: 'm1', channel_id: 'c1', author_id: 'author', body_html: '<p>See page 3</p>', deleted_at: null },
    { id: 'm2', channel_id: 'c1', author_id: 'author', body_html: '<p>Another</p>', deleted_at: null },
  );
  tx.files.rows.push(
    { id: 'f-pdf', project_id: 'p1', name: 'plans.pdf', mime_type: 'application/pdf', current_version_id: 'fv-pdf-1', deleted_at: null },
    { id: 'f-png', project_id: 'p1', name: 'photo.png', mime_type: 'image/png', current_version_id: 'fv-png-1', deleted_at: null },
    { id: 'f-zip', project_id: 'p1', name: 'bundle.zip', mime_type: 'application/zip', current_version_id: 'fv-zip-1', deleted_at: null },
  );
  tx.file_versions.rows.push(
    { id: 'fv-pdf-1', file_id: 'f-pdf', version_number: 1, storage_key: 'k/pdf1' },
    { id: 'fv-png-1', file_id: 'f-png', version_number: 1, storage_key: 'k/png1' },
    { id: 'fv-zip-1', file_id: 'f-zip', version_number: 1, storage_key: 'k/zip1' },
  );
  const prisma = { runAsAdmin: (fn: (t: unknown) => unknown) => fn(tx) };
  const objects: Record<string, Buffer> = {
    'k/pdf1': Buffer.from('%PDF-1.4 fake'),
    'k/png1': Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  };
  const storage = {
    getObjectBuffer: async (key: string) => {
      if (!objects[key]) throw new Error('missing');
      return objects[key];
    },
  };
  return { tx, prisma, storage, objects };
}

export async function makeApp(db: ReturnType<typeof makeDb>): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers: [ReferencesController],
    providers: [
      ReferencesService,
      { provide: PrismaService, useValue: db.prisma },
      { provide: MinioService, useValue: db.storage },
    ],
  }).compile();
  // Mirror main.ts: large JSON bodies reach the validator (which enforces 1 MB).
  const app = moduleRef.createNestApplication({ bodyParser: false });
  app.use(json({ limit: '50mb' }));
  app.use((req: any, _res: any, next: () => void) => {
    const id = req.headers['x-test-user'];
    const u = db.tx.user.rows.find((r) => r.id === id);
    if (u) req.session = { userId: u.id, role: u.role };
    next();
  });
  await app.init();
  return app;
}

export const as = (user: string) => ({ 'x-test-user': user });
