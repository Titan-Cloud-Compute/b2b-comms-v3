import 'reflect-metadata';
import { UnauthorizedException, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as express from 'express';
import request = require('supertest');
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { ReferencesController } from './references.controller';
import { ReferencesService } from './references.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

// ─── UUIDs used in fixtures ──────────────────────────────────────────────────
const AUTHOR_ID       = '00000000-0000-0000-0000-000000000001';
const MEMBER2_ID      = '00000000-0000-0000-0000-000000000002';
const OUTSIDER_ID     = '00000000-0000-0000-0000-000000000003';
const PROJECT_ID      = '00000000-0000-0000-0000-000000000010';
const CHANNEL_ID      = '00000000-0000-0000-0000-000000000011';
const MESSAGE_ID      = '00000000-0000-0000-0000-000000000020';
const PDF_FILE_ID     = '00000000-0000-0000-0000-000000000030';
const PDF_VERSION_ID  = '00000000-0000-0000-0000-000000000031';
const DOCX_FILE_ID    = '00000000-0000-0000-0000-000000000040';
const DOCX_VERSION_ID = '00000000-0000-0000-0000-000000000041';
const DELETED_FILE_ID = '00000000-0000-0000-0000-000000000050';
const DELETED_VER_ID  = '00000000-0000-0000-0000-000000000051';
const STATIC_REF_ID   = '00000000-0000-0000-0000-000000000060';

const VALID_ANNOTATIONS = [{ type: 'text', x: 10, y: 20, content: 'hello' }];

function makeFakePrisma() {
  const members: Row[] = [
    { project_id: PROJECT_ID, user_id: AUTHOR_ID },
    { project_id: PROJECT_ID, user_id: MEMBER2_ID },
  ];

  // mutable so tests can mutate current_version_id
  const filesStore: Row[] = [
    { id: PDF_FILE_ID,     project_id: PROJECT_ID, name: 'doc.pdf',  mime_type: 'application/pdf',  current_version_id: PDF_VERSION_ID,  deleted_at: null },
    { id: DOCX_FILE_ID,    project_id: PROJECT_ID, name: 'doc.docx', mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', current_version_id: DOCX_VERSION_ID, deleted_at: null },
    { id: DELETED_FILE_ID, project_id: PROJECT_ID, name: 'gone.pdf', mime_type: 'application/pdf',  current_version_id: DELETED_VER_ID,  deleted_at: new Date() },
  ];

  const fileVersionsStore: Row[] = [
    { id: PDF_VERSION_ID,  file_id: PDF_FILE_ID },
    { id: DOCX_VERSION_ID, file_id: DOCX_FILE_ID },
    { id: DELETED_VER_ID,  file_id: DELETED_FILE_ID },
  ];

  const messages: Row[] = [
    {
      id: MESSAGE_ID,
      author_id: AUTHOR_ID,
      deleted_at: null,
      channel_id: CHANNEL_ID,
      channel: { project_id: PROJECT_ID, internal_only: false },
    },
  ];

  const references: Row[] = [];
  let seq = 0;
  const nextUuid = () => `${String(++seq).padStart(8, '0')}-0000-0000-0000-000000000000`;

  const db: any = {
    project_members: {
      findFirst: async ({ where }: any) =>
        members.find((m) => m.project_id === where.project_id && m.user_id === where.user_id) ?? null,
    },
    messages: {
      findUnique: async ({ where }: any) => messages.find((m) => m.id === where.id) ?? null,
    },
    files: {
      findUnique: async ({ where }: any) => filesStore.find((f) => f.id === where.id) ?? null,
    },
    file_versions: {
      findUnique: async ({ where }: any) => fileVersionsStore.find((v) => v.id === where.id) ?? null,
    },
    references: {
      findUnique: async ({ where }: any) => {
        if (where.id)         return references.find((r) => r.id === where.id) ?? null;
        if (where.message_id) return references.find((r) => r.message_id === where.message_id) ?? null;
        return null;
      },
      create: async ({ data }: any) => {
        const row = { id: nextUuid(), ...data };
        references.push(row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const row = references.find((r) => r.id === where.id)!;
        Object.assign(row, data);
        return row;
      },
      delete: async ({ where }: any) => {
        const idx = references.findIndex((r) => r.id === where.id);
        if (idx !== -1) references.splice(idx, 1);
      },
    },
    // expose for patching in tests
    _filesStore: filesStore,
  };

  return { db, references, filesStore, fileVersionsStore };
}

const sessions: Record<string, any> = {
  author:   { userId: AUTHOR_ID,   role: 'USER' },
  member2:  { userId: MEMBER2_ID,  role: 'USER' },
  outsider: { userId: OUTSIDER_ID, role: 'USER' },
};

describe('ReferencesController', () => {
  let app: INestApplication;
  let fake: ReturnType<typeof makeFakePrisma>;

  beforeEach(async () => {
    fake = makeFakePrisma();
    const mod = await Test.createTestingModule({
      controllers: [ReferencesController],
      providers: [
        ReferencesService,
        { provide: PrismaService, useValue: fake.db },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: any) => {
          const req = ctx.switchToHttp().getRequest();
          const who = req.headers['x-test-user'];
          if (!who || !sessions[who]) throw new UnauthorizedException('not authenticated');
          req.session = sessions[who];
          return true;
        },
      })
      .compile();

    // bodyParser: false so we can set our own limit (needed for the 1 MB test)
    app = mod.createNestApplication({ bodyParser: false });
    app.use(express.json({ limit: '10mb' }));
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const as = (who: string) => ({
    get:    (url: string)             => request(app.getHttpServer()).get(url).set('x-test-user', who),
    post:   (url: string, body?: any) => request(app.getHttpServer()).post(url).set('x-test-user', who).send(body ?? {}),
    put:    (url: string, body?: any) => request(app.getHttpServer()).put(url).set('x-test-user', who).send(body ?? {}),
    delete: (url: string)             => request(app.getHttpServer()).delete(url).set('x-test-user', who),
  });

  // helper: create a valid reference, return its id
  async function createRef(): Promise<string> {
    const res = await as('author').post(`/api/messages/${MESSAGE_ID}/reference`, {
      file_id: PDF_FILE_ID,
      page_number: 3,
      annotations: VALID_ANNOTATIONS,
    });
    expect(res.status).toBe(201);
    return res.body.id as string;
  }

  // ── 201 create ─────────────────────────────────────────────────────────────
  it('201: author creates a reference', async () => {
    const res = await as('author').post(`/api/messages/${MESSAGE_ID}/reference`, {
      file_id: PDF_FILE_ID,
      page_number: 3,
      annotations: VALID_ANNOTATIONS,
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      message_id: MESSAGE_ID,
      file_version_id: PDF_VERSION_ID,
      file_id: PDF_FILE_ID,
      page_number: 3,
      author_id: AUTHOR_ID,
      can_edit: true,
      file_available: true,
    });
    expect(res.body.page_url).toContain(`/api/file-versions/${PDF_VERSION_ID}/pages/3`);
    expect(fake.references).toHaveLength(1);
  });

  // ── 200 view: can_edit + file_available ────────────────────────────────────
  it('200 view: author sees can_edit true, member2 sees can_edit false', async () => {
    const refId = await createRef();

    const authorView = await as('author').get(`/api/references/${refId}`);
    expect(authorView.status).toBe(200);
    expect(authorView.body.can_edit).toBe(true);
    expect(authorView.body.file_available).toBe(true);

    const member2View = await as('member2').get(`/api/references/${refId}`);
    expect(member2View.status).toBe(200);
    expect(member2View.body.can_edit).toBe(false);
    expect(member2View.body.file_available).toBe(true);
  });

  // ── 200 author edit, updated_at changes ────────────────────────────────────
  it('200 update: author edits annotations and updated_at reflects the change', async () => {
    const refId = await createRef();
    const originalUpdatedAt = fake.references[0].updated_at as Date;

    await new Promise((r) => setTimeout(r, 10));

    const updated = await as('author').put(`/api/references/${refId}`, {
      annotations: [{ type: 'drawing', x: 5, y: 5, points: [] }],
    });
    expect(updated.status).toBe(200);
    expect(updated.body.annotations[0].type).toBe('drawing');
    expect(new Date(updated.body.updated_at).getTime()).toBeGreaterThan(
      originalUpdatedAt.getTime(),
    );
  });

  // ── 403 non-author PUT/DELETE ───────────────────────────────────────────────
  it('403: non-author member cannot PUT or DELETE a reference', async () => {
    const refId = await createRef();

    expect((await as('member2').put(`/api/references/${refId}`, { annotations: VALID_ANNOTATIONS })).status).toBe(403);
    expect((await as('member2').delete(`/api/references/${refId}`)).status).toBe(403);

    expect(fake.references).toHaveLength(1); // still exists
  });

  // ── 403 non-members ────────────────────────────────────────────────────────
  it('403: outsider is rejected on all reference endpoints', async () => {
    const refId = await createRef();

    expect((await as('outsider').get(`/api/references/${refId}`)).status).toBe(403);
    expect((await as('outsider').put(`/api/references/${refId}`, { annotations: VALID_ANNOTATIONS })).status).toBe(403);
    expect((await as('outsider').delete(`/api/references/${refId}`)).status).toBe(403);

    // outsider cannot create (fails at author check first, still 403)
    expect(
      (await as('outsider').post(`/api/messages/${MESSAGE_ID}/reference`, {
        file_id: PDF_FILE_ID,
        page_number: 1,
        annotations: VALID_ANNOTATIONS,
      })).status,
    ).toBe(403);
  });

  // ── 400 non-PDF/image file ─────────────────────────────────────────────────
  it('400: .docx file returns "Only PDF and image files can be referenced"', async () => {
    const res = await as('author').post(`/api/messages/${MESSAGE_ID}/reference`, {
      file_id: DOCX_FILE_ID,
      page_number: 1,
      annotations: VALID_ANNOTATIONS,
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Only PDF and image files/);
    expect(fake.references).toHaveLength(0);
  });

  // ── 400 empty annotations ──────────────────────────────────────────────────
  it('400: empty annotations array is rejected', async () => {
    const res = await as('author').post(`/api/messages/${MESSAGE_ID}/reference`, {
      file_id: PDF_FILE_ID,
      page_number: 1,
      annotations: [],
    });
    expect(res.status).toBe(400);
    expect(fake.references).toHaveLength(0);
  });

  // ── 400 malformed annotations ──────────────────────────────────────────────
  it('400: non-array annotations are rejected', async () => {
    const res = await as('author').post(`/api/messages/${MESSAGE_ID}/reference`, {
      file_id: PDF_FILE_ID,
      page_number: 1,
      annotations: { invalid: true },
    });
    expect(res.status).toBe(400);
    expect(fake.references).toHaveLength(0);
  });

  // ── 400 over 1 MB annotations — no prisma write ───────────────────────────
  it('400: > 1 MB annotations are rejected before any write', async () => {
    const createSpy = jest.spyOn(fake.db.references, 'create');

    // build annotations whose JSON is just over 1 MB
    const bigAnnotations = [{ type: 'text', x: 0, y: 0, blob: 'x'.repeat(1024 * 1024 + 1) }];
    const res = await as('author').post(`/api/messages/${MESSAGE_ID}/reference`, {
      file_id: PDF_FILE_ID,
      page_number: 1,
      annotations: bigAnnotations,
    });
    expect(res.status).toBe(400);
    expect(createSpy).not.toHaveBeenCalled();
    expect(fake.references).toHaveLength(0);
  });

  // ── 401 without session cookie ─────────────────────────────────────────────
  it('401: unauthenticated requests are rejected', async () => {
    const noAuth = () => request(app.getHttpServer());
    expect((await noAuth().post(`/api/messages/${MESSAGE_ID}/reference`).send({})).status).toBe(401);
    expect((await noAuth().get(`/api/references/${STATIC_REF_ID}`)).status).toBe(401);
    expect((await noAuth().put(`/api/references/${STATIC_REF_ID}`).send({})).status).toBe(401);
    expect((await noAuth().delete(`/api/references/${STATIC_REF_ID}`)).status).toBe(401);
  });

  // ── file_available false when file deleted ─────────────────────────────────
  it('200: file_available is false when the referenced file is deleted', async () => {
    // Inject reference manually — create to deleted file is blocked by the service
    fake.references.push({
      id: STATIC_REF_ID,
      message_id: MESSAGE_ID,
      file_version_id: DELETED_VER_ID,
      page_number: 1,
      annotations: VALID_ANNOTATIONS,
      author_id: AUTHOR_ID,
      updated_at: new Date(),
    });

    const view = await as('author').get(`/api/references/${STATIC_REF_ID}`);
    expect(view.status).toBe(200);
    expect(view.body.file_available).toBe(false);
    expect(view.body.file_version_id).toBe(DELETED_VER_ID);
  });

  // ── file_version_id unchanged after current_version_id changes ────────────
  it('file_version_id is unchanged after the file gets a newer current version', async () => {
    const refId = await createRef();
    expect(fake.references[0].file_version_id).toBe(PDF_VERSION_ID);

    // Simulate a newer upload: bump current_version_id on the PDF file
    const pdfRow = fake.filesStore.find((f: Row) => f.id === PDF_FILE_ID)!;
    pdfRow.current_version_id = '99999999-0000-0000-0000-000000000000';

    const view = await as('author').get(`/api/references/${refId}`);
    expect(view.status).toBe(200);
    expect(view.body.file_version_id).toBe(PDF_VERSION_ID); // still original version
  });
});
