import 'reflect-metadata';
import { UnauthorizedException, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request = require('supertest');
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { MessageReferencesController, ReferencesController } from './references.controller';
import { ReferencesService, UNSUPPORTED_FILE_MESSAGE } from './references.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

type Row = Record<string, any>;

const P1 = '10000000-0000-4000-8000-000000000001';
const P2 = '10000000-0000-4000-8000-000000000002';
const CH1 = '20000000-0000-4000-8000-000000000001';
const M1 = '30000000-0000-4000-8000-000000000001';
const M2 = '30000000-0000-4000-8000-000000000002';
const F_PDF = '40000000-0000-4000-8000-000000000001';
const F_DOC = '40000000-0000-4000-8000-000000000002';
const F_IMG = '40000000-0000-4000-8000-000000000003';
const V_PDF1 = '50000000-0000-4000-8000-000000000001';
const V_DOC1 = '50000000-0000-4000-8000-000000000002';
const V_IMG1 = '50000000-0000-4000-8000-000000000003';
const V_PDF2 = '50000000-0000-4000-8000-000000000004';

const ANN = [
  { type: 'text', x: 0.2, y: 0.3, text: 'Check this dimension' },
  { type: 'stroke', points: [[0.1, 0.1], [0.4, 0.5]] },
];

function makeFakePrisma() {
  const members: Row[] = [
    { project_id: P1, user_id: 'author' },
    { project_id: P1, user_id: 'viewer' },
    { project_id: P2, user_id: 'outsider' },
  ];
  const channels: Row[] = [{ id: CH1, project_id: P1 }];
  const messages: Row[] = [
    { id: M1, channel_id: CH1, author_id: 'author', deleted_at: null },
    { id: M2, channel_id: CH1, author_id: 'author', deleted_at: null },
  ];
  const files: Row[] = [
    { id: F_PDF, project_id: P1, name: 'plan.pdf', mime_type: 'application/pdf', current_version_id: V_PDF1, deleted_at: null },
    { id: F_DOC, project_id: P1, name: 'spec.docx', mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', current_version_id: V_DOC1, deleted_at: null },
    { id: F_IMG, project_id: P1, name: 'photo.png', mime_type: 'image/png', current_version_id: V_IMG1, deleted_at: null },
  ];
  const versions: Row[] = [
    { id: V_PDF1, file_id: F_PDF, version_number: 1 },
    { id: V_DOC1, file_id: F_DOC, version_number: 1 },
    { id: V_IMG1, file_id: F_IMG, version_number: 1 },
    { id: V_PDF2, file_id: F_PDF, version_number: 2 },
  ];
  const references: Row[] = [];
  let seq = 0;

  const withMessage = (m: Row, include: any) =>
    include?.channel ? { ...m, channel: channels.find((c) => c.id === m.channel_id) } : { ...m };

  const db: any = {
    project_members: {
      findUnique: async ({ where }: any) =>
        members.find((m) => m.project_id === where.project_id_user_id.project_id && m.user_id === where.project_id_user_id.user_id) ?? null,
    },
    messages: {
      findFirst: async ({ where, include }: any) => {
        const m = messages.find((x) => x.id === where.id && (where.deleted_at !== null || !x.deleted_at));
        return m ? withMessage(m, include) : null;
      },
    },
    files: {
      findFirst: async ({ where }: any) => files.find((f) => f.id === where.id && !f.deleted_at) ?? null,
    },
    references: {
      findUnique: async ({ where, include }: any) => {
        const r = references.find((x) => (where.id ? x.id === where.id : x.message_id === where.message_id));
        if (!r) return null;
        if (!include) return { ...r };
        const msg = messages.find((m) => m.id === r.message_id)!;
        const v = versions.find((x) => x.id === r.file_version_id)!;
        return {
          ...r,
          message: withMessage(msg, include.message?.include),
          file_version: { ...v, file: files.find((f) => f.id === v.file_id) },
        };
      },
      create: async ({ data }: any) => {
        const row = { id: `60000000-0000-4000-8000-00000000000${++seq}`, updated_at: new Date(2026, 0, 1), ...data };
        references.push(row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const r = references.find((x) => x.id === where.id)!;
        Object.assign(r, data);
        return r;
      },
      delete: async ({ where }: any) => {
        const i = references.findIndex((x) => x.id === where.id);
        return references.splice(i, 1)[0];
      },
    },
  };
  return { db, references, files };
}

describe('References HTTP', () => {
  let app: INestApplication;
  let fake: ReturnType<typeof makeFakePrisma>;

  beforeEach(async () => {
    fake = makeFakePrisma();
    const mod = await Test.createTestingModule({
      controllers: [MessageReferencesController, ReferencesController],
      providers: [ReferencesService, { provide: PrismaService, useValue: fake.db }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: any) => {
          const req = ctx.switchToHttp().getRequest();
          const who = req.headers['x-test-user'];
          if (!who) throw new UnauthorizedException();
          req.session = { userId: who };
          return true;
        },
      })
      .compile();
    // Mirror main.ts: JSON bodies up to 50 MB reach the handler, so the 1 MB annotation cap is a 400.
    const nest = mod.createNestApplication<NestExpressApplication>({ bodyParser: false });
    nest.useBodyParser('json', { limit: '50mb' });
    app = nest;
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const create = (user: string, body: any, messageId = M1) =>
    request(app.getHttpServer()).post(`/api/messages/${messageId}/reference`).set('x-test-user', user).send(body);

  it('creates a reference (201) with annotations, page_number and the current file_version_id', async () => {
    const res = await create('author', { fileId: F_PDF, pageNumber: 3, annotations: ANN });
    expect(res.status).toBe(201);
    expect(fake.references).toHaveLength(1);
    expect(fake.references[0]).toMatchObject({ message_id: M1, file_version_id: V_PDF1, page_number: 3, author_id: 'author' });
    expect(fake.references[0].annotations).toEqual(ANN);
    expect(res.body.can_edit).toBe(true);
  });

  it('rejects non-PDF/image files with 400', async () => {
    const res = await create('author', { fileId: F_DOC, pageNumber: 1, annotations: ANN });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain(UNSUPPORTED_FILE_MESSAGE);
    expect(fake.references).toHaveLength(0);
  });

  it('rejects empty, malformed and oversized annotations with 400', async () => {
    expect((await create('author', { fileId: F_PDF, annotations: [] })).status).toBe(400);
    expect((await create('author', { fileId: F_PDF, annotations: [{ type: 'blob' }] })).status).toBe(400);
    const huge = Array.from({ length: 600 }, () => ({ type: 'text', x: 0.5, y: 0.5, text: 'x'.repeat(1999) }));
    expect((await create('author', { fileId: F_PDF, annotations: huge })).status).toBe(400);
    expect(fake.references).toHaveLength(0);
  });

  it('returns 401 for unauthenticated requests and 403 for non-members', async () => {
    const created = await create('author', { fileId: F_IMG, annotations: ANN });
    const id = created.body.id;
    expect((await request(app.getHttpServer()).get(`/api/references/${id}`)).status).toBe(401);
    expect((await request(app.getHttpServer()).get(`/api/references/${id}`).set('x-test-user', 'outsider')).status).toBe(403);
    expect((await create('outsider', { fileId: F_IMG, annotations: ANN }, M2)).status).toBe(403);
  });

  it('viewer gets read-only view; PUT and DELETE are 403 for non-authors', async () => {
    const id = (await create('author', { fileId: F_PDF, pageNumber: 2, annotations: ANN })).body.id;
    const view = await request(app.getHttpServer()).get(`/api/references/${id}`).set('x-test-user', 'viewer');
    expect(view.status).toBe(200);
    expect(view.body).toMatchObject({ can_edit: false, file_available: true, file_version_id: V_PDF1, page_number: 2 });
    expect(view.body.annotations).toEqual(ANN);
    const put = await request(app.getHttpServer()).put(`/api/references/${id}`).set('x-test-user', 'viewer').send({ annotations: ANN });
    expect(put.status).toBe(403);
    const del = await request(app.getHttpServer()).delete(`/api/references/${id}`).set('x-test-user', 'viewer');
    expect(del.status).toBe(403);
    expect(fake.references).toHaveLength(1);
  });

  it('author edits annotations (200) and updated_at changes; bad payload leaves the row unchanged', async () => {
    const id = (await create('author', { fileId: F_PDF, annotations: ANN })).body.id;
    const before = fake.references[0].updated_at;
    const next = [{ type: 'text', x: 0.5, y: 0.5, text: 'Revised' }];
    const put = await request(app.getHttpServer()).put(`/api/references/${id}`).set('x-test-user', 'author').send({ annotations: next });
    expect(put.status).toBe(200);
    expect(fake.references[0].annotations).toEqual(next);
    expect(fake.references[0].updated_at.getTime()).toBeGreaterThan(before.getTime());
    const bad = await request(app.getHttpServer()).put(`/api/references/${id}`).set('x-test-user', 'author').send({ annotations: [] });
    expect(bad.status).toBe(400);
    expect(fake.references[0].annotations).toEqual(next);
  });

  it('keeps the original file_version_id when a newer version is uploaded', async () => {
    const id = (await create('author', { fileId: F_PDF, annotations: ANN })).body.id;
    fake.files.find((f) => f.id === F_PDF)!.current_version_id = V_PDF2;
    const view = await request(app.getHttpServer()).get(`/api/references/${id}`).set('x-test-user', 'viewer');
    expect(view.body.file_version_id).toBe(V_PDF1);
  });

  it('reports file_available false when the file was deleted', async () => {
    const id = (await create('author', { fileId: F_PDF, annotations: ANN })).body.id;
    fake.files.find((f) => f.id === F_PDF)!.deleted_at = new Date();
    const view = await request(app.getHttpServer()).get(`/api/references/${id}`).set('x-test-user', 'viewer');
    expect(view.status).toBe(200);
    expect(view.body.file_available).toBe(false);
  });

  it('author deletes the reference (204)', async () => {
    const id = (await create('author', { fileId: F_PDF, annotations: ANN })).body.id;
    const del = await request(app.getHttpServer()).delete(`/api/references/${id}`).set('x-test-user', 'author');
    expect(del.status).toBe(204);
    expect(fake.references).toHaveLength(0);
  });
});
