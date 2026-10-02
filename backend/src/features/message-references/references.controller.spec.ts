import 'reflect-metadata';
import { UnauthorizedException, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request = require('supertest');
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { ReferencesController } from './references.controller';
import { ReferencesService } from './references.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

// ---------------------------------------------------------------------------
// UUIDs for fixtures
// ---------------------------------------------------------------------------
const UUID = {
  project1: '00000000-0000-0000-0000-000000000001',
  project2: '00000000-0000-0000-0000-000000000002',
  author: '00000000-0000-0000-0000-000000000010',
  member: '00000000-0000-0000-0000-000000000011',
  nonMember: '00000000-0000-0000-0000-000000000012',
  channel1: '00000000-0000-0000-0000-000000000020',
  message1: '00000000-0000-0000-0000-000000000030',
  message2: '00000000-0000-0000-0000-000000000031', // no reference yet (for duplicate check)
  pdfFile: '00000000-0000-0000-0000-000000000040',
  pdfFileVer: '00000000-0000-0000-0000-000000000041',
  imageFile: '00000000-0000-0000-0000-000000000042',
  imageFileVer: '00000000-0000-0000-0000-000000000043',
  docxFile: '00000000-0000-0000-0000-000000000044',
  docxFileVer: '00000000-0000-0000-0000-000000000045',
  deletedFile: '00000000-0000-0000-0000-000000000046',
  deletedFileVer: '00000000-0000-0000-0000-000000000047',
  ref1: '00000000-0000-0000-0000-000000000050',
  newerFileVer: '00000000-0000-0000-0000-000000000048',
};

const VALID_ANNOTATION = [
  { type: 'text', x: 0.1, y: 0.1, width: 0.3, height: 0.05, text: 'Hello' },
];

// ---------------------------------------------------------------------------
// Fake PrismaService
// ---------------------------------------------------------------------------

function makeFakePrisma() {
  const users: Row[] = [
    { id: UUID.author, email: 'author@x.com', organization_id: 'org-int', organization: { is_internal: true } },
    { id: UUID.member, email: 'member@x.com', organization_id: 'org-int', organization: { is_internal: true } },
    { id: UUID.nonMember, email: 'nonmember@x.com', organization_id: 'org-ext', organization: { is_internal: false } },
  ];

  const projectMembers: Row[] = [
    { project_id: UUID.project1, user_id: UUID.author },
    { project_id: UUID.project1, user_id: UUID.member },
  ];

  const channels: Row[] = [
    {
      id: UUID.channel1,
      project_id: UUID.project1,
      internal_only: false,
    },
  ];

  const messages: Row[] = [
    {
      id: UUID.message1,
      channel_id: UUID.channel1,
      author_id: UUID.author,
      deleted_at: null,
      channel: channels[0],
    },
    {
      id: UUID.message2,
      channel_id: UUID.channel1,
      author_id: UUID.author,
      deleted_at: null,
      channel: channels[0],
    },
  ];

  const pdfFileVer: Row = {
    id: UUID.pdfFileVer,
    file_id: UUID.pdfFile,
    version_number: 1,
  };
  const imageFileVer: Row = {
    id: UUID.imageFileVer,
    file_id: UUID.imageFile,
    version_number: 1,
  };
  const docxFileVer: Row = {
    id: UUID.docxFileVer,
    file_id: UUID.docxFile,
    version_number: 1,
  };
  const deletedFileVer: Row = {
    id: UUID.deletedFileVer,
    file_id: UUID.deletedFile,
    version_number: 1,
  };
  const newerFileVer: Row = {
    id: UUID.newerFileVer,
    file_id: UUID.pdfFile,
    version_number: 2,
  };

  const files: Row[] = [
    { id: UUID.pdfFile, project_id: UUID.project1, name: 'doc.pdf', mime_type: 'application/pdf', current_version_id: UUID.pdfFileVer, deleted_at: null },
    { id: UUID.imageFile, project_id: UUID.project1, name: 'img.png', mime_type: 'image/png', current_version_id: UUID.imageFileVer, deleted_at: null },
    { id: UUID.docxFile, project_id: UUID.project1, name: 'doc.docx', mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', current_version_id: UUID.docxFileVer, deleted_at: null },
    { id: UUID.deletedFile, project_id: UUID.project1, name: 'deleted.pdf', mime_type: 'application/pdf', current_version_id: UUID.deletedFileVer, deleted_at: new Date() },
  ];

  // Attach file backreferences to file versions
  pdfFileVer.file = files[0];
  imageFileVer.file = files[1];
  docxFileVer.file = files[2];
  deletedFileVer.file = files[3];
  newerFileVer.file = files[0];

  const fileVersions: Row[] = [pdfFileVer, imageFileVer, docxFileVer, deletedFileVer, newerFileVer];

  const references: Row[] = [];
  let seq = 0;
  const nextId = () => {
    seq++;
    return `ffffffff-ffff-ffff-ffff-${String(seq).padStart(12, '0')}`;
  };

  // prisma.create spy counter
  let createCallCount = 0;

  const db: any = {
    _getCreateCallCount: () => createCallCount,

    users: {
      findUnique: async ({ where }: any) => users.find((u) => u.id === where.id) ?? null,
    },
    project_members: {
      findFirst: async ({ where }: any) =>
        projectMembers.find((m) => m.project_id === where.project_id && m.user_id === where.user_id) ?? null,
    },
    messages: {
      findUnique: async ({ where, include }: any) => {
        const m = messages.find((x) => x.id === where.id);
        if (!m) return null;
        const result = { ...m };
        if (include?.channel) {
          result.channel = channels.find((c) => c.id === m.channel_id) ?? m.channel;
        }
        return result;
      },
    },
    files: {
      findUnique: async ({ where }: any) => files.find((f) => f.id === where.id) ?? null,
    },
    file_versions: {
      findUnique: async ({ where, include }: any) => {
        const fv = fileVersions.find((v) => v.id === where.id);
        if (!fv) return null;
        const result = { ...fv };
        if (include?.file) {
          result.file = files.find((f) => f.id === fv.file_id) ?? fv.file;
        }
        return result;
      },
    },
    references: {
      findUnique: async ({ where, include }: any) => {
        let ref: Row | undefined;
        if (where.id) ref = references.find((r) => r.id === where.id);
        if (where.message_id) ref = references.find((r) => r.message_id === where.message_id);
        if (!ref) return null;
        const result = { ...ref };
        if (include?.message) {
          const msg = messages.find((m) => m.id === ref!.message_id);
          if (msg) {
            result.message = { ...msg };
            if (include.message.include?.channel) {
              result.message.channel = channels.find((c) => c.id === msg.channel_id) ?? msg.channel;
            }
          }
        }
        if (include?.file_version) {
          const fv = fileVersions.find((v) => v.id === ref!.file_version_id);
          if (fv) {
            result.file_version = { ...fv };
            if (include.file_version.include?.file) {
              result.file_version.file = files.find((f) => f.id === fv.file_id) ?? fv.file;
            }
          }
        }
        return result;
      },
      create: async ({ data }: any) => {
        createCallCount++;
        const row: Row = { id: nextId(), ...data };
        references.push(row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const ref = references.find((r) => r.id === where.id);
        if (!ref) throw new Error('not found');
        Object.assign(ref, data);
        return ref;
      },
      delete: async ({ where }: any) => {
        const idx = references.findIndex((r) => r.id === where.id);
        if (idx >= 0) references.splice(idx, 1);
      },
    },
  };

  return { db, references, files };
}

// ---------------------------------------------------------------------------
// Session map
// ---------------------------------------------------------------------------

const sessions: Record<string, any> = {
  author: { userId: UUID.author, role: 'USER', firmId: null, organizationId: 'org-int' },
  member: { userId: UUID.member, role: 'USER', firmId: null, organizationId: 'org-int' },
  nonMember: { userId: UUID.nonMember, role: 'USER', firmId: null, organizationId: 'org-ext' },
};

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('References Controller (HTTP)', () => {
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
    app = mod.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const as = (who: string) => ({
    get: (url: string) => request(app.getHttpServer()).get(url).set('x-test-user', who),
    post: (url: string, body?: any) => request(app.getHttpServer()).post(url).set('x-test-user', who).send(body ?? {}),
    put: (url: string, body?: any) => request(app.getHttpServer()).put(url).set('x-test-user', who).send(body ?? {}),
    delete: (url: string) => request(app.getHttpServer()).delete(url).set('x-test-user', who),
  });

  const noAuth = {
    get: (url: string) => request(app.getHttpServer()).get(url),
    post: (url: string, body?: any) => request(app.getHttpServer()).post(url).send(body ?? {}),
    put: (url: string, body?: any) => request(app.getHttpServer()).put(url).send(body ?? {}),
    delete: (url: string) => request(app.getHttpServer()).delete(url),
  };

  // ----- 401 without session -----
  describe('401 without session cookie', () => {
    it('GET /api/references/:id returns 401 when no session', async () => {
      const res = await noAuth.get(`/api/references/${UUID.ref1}`);
      expect(res.status).toBe(401);
    });

    it('POST /api/messages/:id/reference returns 401 when no session', async () => {
      const res = await noAuth.post(`/api/messages/${UUID.message1}/reference`, {
        file_version_id: UUID.pdfFileVer,
        page_number: 1,
        annotations: VALID_ANNOTATION,
      });
      expect(res.status).toBe(401);
    });
  });

  // ----- 403 non-members -----
  describe('403 for non-members', () => {
    it('POST returns 403 for non-member', async () => {
      // Non-member is not the author either (author check happens first, but author is also non-member)
      // Use nonMember as a message sent from author — they'll fail membership
      const res = await as('nonMember').post(`/api/messages/${UUID.message1}/reference`, {
        file_version_id: UUID.pdfFileVer,
        page_number: 1,
        annotations: VALID_ANNOTATION,
      });
      // They fail author check first (403)
      expect(res.status).toBe(403);
    });

    it('GET reference returns 403 for non-member', async () => {
      // First create a reference as the author
      const createRes = await as('author').post(`/api/messages/${UUID.message1}/reference`, {
        file_version_id: UUID.pdfFileVer,
        page_number: 2,
        annotations: VALID_ANNOTATION,
      });
      expect(createRes.status).toBe(201);
      const refId = createRes.body.id;

      const res = await as('nonMember').get(`/api/references/${refId}`);
      expect(res.status).toBe(403);
    });

    it('PUT returns 403 for non-member', async () => {
      const createRes = await as('author').post(`/api/messages/${UUID.message1}/reference`, {
        file_version_id: UUID.pdfFileVer,
        page_number: 2,
        annotations: VALID_ANNOTATION,
      });
      expect(createRes.status).toBe(201);
      const refId = createRes.body.id;

      const res = await as('nonMember').put(`/api/references/${refId}`, {
        annotations: VALID_ANNOTATION,
      });
      expect(res.status).toBe(403);
    });

    it('DELETE returns 403 for non-member', async () => {
      const createRes = await as('author').post(`/api/messages/${UUID.message1}/reference`, {
        file_version_id: UUID.pdfFileVer,
        page_number: 2,
        annotations: VALID_ANNOTATION,
      });
      expect(createRes.status).toBe(201);
      const refId = createRes.body.id;

      const res = await as('nonMember').delete(`/api/references/${refId}`);
      expect(res.status).toBe(403);
    });
  });

  // ----- 201 create -----
  describe('201 create reference', () => {
    it('author can create a reference on their message (201)', async () => {
      const res = await as('author').post(`/api/messages/${UUID.message1}/reference`, {
        file_version_id: UUID.pdfFileVer,
        page_number: 2,
        annotations: VALID_ANNOTATION,
      });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        message_id: UUID.message1,
        file_version_id: UUID.pdfFileVer,
        page_number: 2,
        author_id: UUID.author,
        can_edit: true,
        file_available: true,
        page_url: `/api/file-versions/${UUID.pdfFileVer}/pages/2`,
      });
      expect(fake.references).toHaveLength(1);
    });

    it('can create using file_id (resolves current_version_id)', async () => {
      const res = await as('author').post(`/api/messages/${UUID.message1}/reference`, {
        file_id: UUID.pdfFile,
        page_number: 1,
        annotations: VALID_ANNOTATION,
      });
      expect(res.status).toBe(201);
      expect(res.body.file_version_id).toBe(UUID.pdfFileVer);
    });
  });

  // ----- 200 view -----
  describe('200 view reference', () => {
    it('member can view reference with can_edit=false', async () => {
      await as('author').post(`/api/messages/${UUID.message1}/reference`, {
        file_version_id: UUID.pdfFileVer,
        page_number: 3,
        annotations: VALID_ANNOTATION,
      });
      const refId = fake.references[0].id;

      const res = await as('member').get(`/api/references/${refId}`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: refId,
        can_edit: false,
        file_available: true,
        page_url: `/api/file-versions/${UUID.pdfFileVer}/pages/3`,
      });
    });

    it('author views with can_edit=true', async () => {
      await as('author').post(`/api/messages/${UUID.message1}/reference`, {
        file_version_id: UUID.pdfFileVer,
        page_number: 1,
        annotations: VALID_ANNOTATION,
      });
      const refId = fake.references[0].id;

      const res = await as('author').get(`/api/references/${refId}`);
      expect(res.status).toBe(200);
      expect(res.body.can_edit).toBe(true);
    });

    it('file_available is false when file is deleted', async () => {
      // Pre-seed a reference pointing at the deleted file version
      // (simulating a reference saved before the file was deleted)
      fake.references.push({
        id: UUID.ref1,
        message_id: UUID.message1,
        file_version_id: UUID.deletedFileVer,
        page_number: 1,
        annotations: VALID_ANNOTATION,
        author_id: UUID.author,
        updated_at: new Date(),
      });

      const res = await as('author').get(`/api/references/${UUID.ref1}`);
      expect(res.status).toBe(200);
      expect(res.body.file_available).toBe(false);
    });

    it('file_version_id is unchanged after file.current_version_id moves to newer version', async () => {
      await as('author').post(`/api/messages/${UUID.message1}/reference`, {
        file_version_id: UUID.pdfFileVer,
        page_number: 1,
        annotations: VALID_ANNOTATION,
      });
      const refId = fake.references[0].id;

      // Simulate a newer version being uploaded by updating current_version_id on the file
      const pdfFile = fake.files.find((f: Row) => f.id === UUID.pdfFile)!;
      pdfFile.current_version_id = UUID.newerFileVer;

      const res = await as('author').get(`/api/references/${refId}`);
      expect(res.status).toBe(200);
      // The stored file_version_id must still be the ORIGINAL version
      expect(res.body.file_version_id).toBe(UUID.pdfFileVer);
    });
  });

  // ----- 200 author edit -----
  describe('200 author edit', () => {
    it('author can update annotations and gets new updated_at', async () => {
      await as('author').post(`/api/messages/${UUID.message1}/reference`, {
        file_version_id: UUID.pdfFileVer,
        page_number: 1,
        annotations: VALID_ANNOTATION,
      });
      const refId = fake.references[0].id;
      const originalUpdatedAt = fake.references[0].updated_at;

      const newAnnotation = [
        { type: 'text', x: 0.5, y: 0.5, width: 0.2, height: 0.1, text: 'Updated' },
      ];

      const res = await as('author').put(`/api/references/${refId}`, {
        annotations: newAnnotation,
        page_number: 2,
      });
      expect(res.status).toBe(200);
      expect(res.body.page_number).toBe(2);
      // updated_at should have changed
      expect(new Date(res.body.updated_at).getTime()).toBeGreaterThanOrEqual(
        new Date(originalUpdatedAt).getTime(),
      );
    });
  });

  // ----- 403 non-author PUT/DELETE -----
  describe('403 non-author PUT/DELETE', () => {
    it('member (non-author) PUT returns 403', async () => {
      await as('author').post(`/api/messages/${UUID.message1}/reference`, {
        file_version_id: UUID.pdfFileVer,
        page_number: 1,
        annotations: VALID_ANNOTATION,
      });
      const refId = fake.references[0].id;

      const res = await as('member').put(`/api/references/${refId}`, {
        annotations: VALID_ANNOTATION,
      });
      expect(res.status).toBe(403);
    });

    it('member (non-author) DELETE returns 403', async () => {
      await as('author').post(`/api/messages/${UUID.message1}/reference`, {
        file_version_id: UUID.pdfFileVer,
        page_number: 1,
        annotations: VALID_ANNOTATION,
      });
      const refId = fake.references[0].id;

      const res = await as('member').delete(`/api/references/${refId}`);
      expect(res.status).toBe(403);
    });
  });

  // ----- 400 non-PDF/image file -----
  describe('400 for non-PDF/image file', () => {
    it('returns 400 when trying to reference a .docx file', async () => {
      const res = await as('author').post(`/api/messages/${UUID.message1}/reference`, {
        file_version_id: UUID.docxFileVer,
        page_number: 1,
        annotations: VALID_ANNOTATION,
      });
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toMatch(/Only PDF and image files/);
    });
  });

  // ----- 400 empty/malformed annotations -----
  describe('400 for empty or malformed annotations', () => {
    it('returns 400 for empty annotations array', async () => {
      const res = await as('author').post(`/api/messages/${UUID.message1}/reference`, {
        file_version_id: UUID.pdfFileVer,
        page_number: 1,
        annotations: [],
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 for malformed annotations', async () => {
      const res = await as('author').post(`/api/messages/${UUID.message1}/reference`, {
        file_version_id: UUID.pdfFileVer,
        page_number: 1,
        annotations: [{ type: 'unknown-shape', x: 0.1 }],
      });
      expect(res.status).toBe(400);
    });

    it('returns 4xx for >1MB annotations and no prisma.create is called', async () => {
      const bigPath = {
        type: 'path',
        points: Array.from({ length: 5000 }, (_, i) => ({
          x: (i % 100) / 100,
          y: Math.floor(i / 100) / 50,
        })),
      };
      const singleSize = Buffer.byteLength(JSON.stringify([bigPath]));
      const count = Math.ceil(1_048_576 / singleSize) + 1;
      const bigAnnotations = Array.from({ length: count }, () => bigPath);

      const before = fake.db._getCreateCallCount();
      const res = await as('author').post(`/api/messages/${UUID.message1}/reference`, {
        file_version_id: UUID.pdfFileVer,
        page_number: 1,
        annotations: bigAnnotations,
      });
      // Either 400 (validation rejected it) or 413 (transport rejected it) —
      // both mean no row was stored.
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
      // No prisma.create should have been called
      expect(fake.db._getCreateCallCount()).toBe(before);
    });
  });

  // ----- 409 duplicate reference -----
  describe('409 duplicate reference on same message', () => {
    it('returns 409 when trying to add a second reference on the same message', async () => {
      await as('author').post(`/api/messages/${UUID.message1}/reference`, {
        file_version_id: UUID.pdfFileVer,
        page_number: 1,
        annotations: VALID_ANNOTATION,
      });

      const res = await as('author').post(`/api/messages/${UUID.message1}/reference`, {
        file_version_id: UUID.pdfFileVer,
        page_number: 1,
        annotations: VALID_ANNOTATION,
      });
      expect(res.status).toBe(409);
    });
  });
});
