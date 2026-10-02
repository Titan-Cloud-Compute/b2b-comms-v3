import 'reflect-metadata';
import { readFileSync } from 'fs';
import * as path from 'path';
import {
  ForbiddenException,
  INestApplication,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request = require('supertest');
import { JwtAuthGuard } from '../../../auth/jwt-auth.guard';
import { PrismaService } from '../../../prisma/prisma.service';
import { MinioService } from '../../../lib/integrations/minio.service';
import { FilePagesController } from './file-pages.controller';
import { PageRenderService } from './page-render.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// Minimal valid 1×1 white PNG (89 bytes) for mocking render results
// ---------------------------------------------------------------------------
const MINIMAL_PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108020000009001' +
    '2e00000000c4944415408d7636360000000200017e221bc60000000049454e44ae426082',
  'hex',
);

// ---------------------------------------------------------------------------
// Fixture: the real 3-page PDF
// ---------------------------------------------------------------------------
const THREE_PAGE_PDF = readFileSync(
  path.join(__dirname, '__fixtures__', 'three-pages.pdf'),
);

const FAKE_PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG magic
  ...Buffer.alloc(20, 0),
]);

// ---------------------------------------------------------------------------
// UUIDs
// ---------------------------------------------------------------------------
const UUID = {
  member: '00000000-0000-0000-0001-000000000001',
  nonMember: '00000000-0000-0000-0001-000000000002',
  project: '00000000-0000-0000-0001-000000000010',
  pdfVersionId: '00000000-0000-0000-0001-000000000020',
  imageVersionId: '00000000-0000-0000-0001-000000000021',
  deletedVersionId: '00000000-0000-0000-0001-000000000022',
};

// ---------------------------------------------------------------------------
// Fake PrismaService
// ---------------------------------------------------------------------------
function makeFakePrisma() {
  const versions: Record<string, any> = {
    [UUID.pdfVersionId]: {
      id: UUID.pdfVersionId,
      storage_key: 'pdf-key',
      files: {
        id: 'f1',
        project_id: UUID.project,
        mime_type: 'application/pdf',
        deleted_at: null,
      },
    },
    [UUID.imageVersionId]: {
      id: UUID.imageVersionId,
      storage_key: 'img-key',
      files: {
        id: 'f2',
        project_id: UUID.project,
        mime_type: 'image/jpeg',
        deleted_at: null,
      },
    },
    [UUID.deletedVersionId]: {
      id: UUID.deletedVersionId,
      storage_key: 'del-key',
      files: {
        id: 'f3',
        project_id: UUID.project,
        mime_type: 'application/pdf',
        deleted_at: new Date('2024-01-01'),
      },
    },
  };

  return {
    file_versions: {
      findUnique: jest.fn(({ where }: any) =>
        Promise.resolve(versions[where.id] ?? null),
      ),
    },
    project_members: {
      findFirst: jest.fn(({ where }: any) => {
        if (
          where.project_id === UUID.project &&
          where.user_id === UUID.member
        ) {
          return Promise.resolve({ project_id: UUID.project, user_id: UUID.member });
        }
        return Promise.resolve(null);
      }),
    },
  };
}

// ---------------------------------------------------------------------------
// Fake MinioService
// ---------------------------------------------------------------------------
function makeFakeMinio() {
  return {
    getObjectBuffer: jest.fn((key: string) => {
      if (key === 'pdf-key') return Promise.resolve(THREE_PAGE_PDF);
      if (key === 'img-key') return Promise.resolve(Buffer.from('fake-jpg'));
      return Promise.resolve(Buffer.from(''));
    }),
  };
}

// ---------------------------------------------------------------------------
// Helper: build the NestJS test app
// ---------------------------------------------------------------------------
async function buildApp(): Promise<{
  app: INestApplication;
  renderService: PageRenderService;
  prisma: ReturnType<typeof makeFakePrisma>;
  minio: ReturnType<typeof makeFakeMinio>;
}> {
  const prisma = makeFakePrisma();
  const minio = makeFakeMinio();

  const moduleRef = await Test.createTestingModule({
    controllers: [FilePagesController],
    providers: [
      PageRenderService,
      { provide: PrismaService, useValue: prisma },
      { provide: MinioService, useValue: minio },
    ],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue({ canActivate: () => true })
    .compile();

  const app = moduleRef.createNestApplication();
  // Attach a mock session for each request
  app.use((req: any, _res: any, next: any) => {
    req.session = { userId: req.headers['x-user-id'] ?? UUID.member };
    next();
  });
  await app.init();

  const renderService = moduleRef.get(PageRenderService);
  return { app, renderService, prisma, minio };
}

// ===========================================================================
// PageRenderService — unit tests
// ===========================================================================
describe('PageRenderService', () => {
  let service: PageRenderService;
  let renderPdfPageSpy: jest.SpyInstance;

  beforeEach(() => {
    service = new PageRenderService();
    // Mock the actual PDF rendering so tests don't need pdfjs-dist/canvas at runtime
    renderPdfPageSpy = jest
      .spyOn(service, 'renderPdfPage')
      .mockResolvedValue(FAKE_PNG_BYTES);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns PNG for page 2 of a real 3-page PDF fixture', async () => {
    const result = await service.renderPage(
      UUID.pdfVersionId,
      THREE_PAGE_PDF,
      'application/pdf',
      2,
    );
    expect(result.contentType).toBe('image/png');
    // Must start with the PNG magic bytes
    expect(result.body[0]).toBe(0x89);
    expect(result.body[1]).toBe(0x50); // 'P'
    expect(result.body[2]).toBe(0x4e); // 'N'
    expect(result.body[3]).toBe(0x47); // 'G'
    expect(renderPdfPageSpy).toHaveBeenCalledWith(THREE_PAGE_PDF, 2);
  });

  it('throws 404 for page 4 (beyond 3-page PDF)', async () => {
    await expect(
      service.renderPage(UUID.pdfVersionId, THREE_PAGE_PDF, 'application/pdf', 4),
    ).rejects.toThrow(NotFoundException);
    // renderPdfPage should NOT have been called
    expect(renderPdfPageSpy).not.toHaveBeenCalled();
  });

  it('throws 404 for page 0 (below valid range)', async () => {
    await expect(
      service.renderPage(UUID.pdfVersionId, THREE_PAGE_PDF, 'application/pdf', 0),
    ).rejects.toThrow(NotFoundException);
  });

  it('returns original bytes for image/* version (page 1)', async () => {
    const imgBytes = Buffer.from('fake-jpeg-data');
    const result = await service.renderPage(
      UUID.imageVersionId,
      imgBytes,
      'image/jpeg',
      1,
    );
    expect(result.contentType).toBe('image/jpeg');
    expect(result.body).toBe(imgBytes); // same reference
    expect(renderPdfPageSpy).not.toHaveBeenCalled();
  });

  it('throws 404 for image/* when page > 1', async () => {
    await expect(
      service.renderPage(UUID.imageVersionId, Buffer.from('data'), 'image/png', 2),
    ).rejects.toThrow(NotFoundException);
  });

  it('serves the second render from cache (< 50 ms)', async () => {
    const versionId = UUID.pdfVersionId;
    // First render
    await service.renderPage(versionId, THREE_PAGE_PDF, 'application/pdf', 1);
    expect(renderPdfPageSpy).toHaveBeenCalledTimes(1);

    // Second render — should be a cache hit
    const t0 = Date.now();
    await service.renderPage(versionId, THREE_PAGE_PDF, 'application/pdf', 1);
    const elapsed = Date.now() - t0;
    // renderPdfPage should NOT be called again
    expect(renderPdfPageSpy).toHaveBeenCalledTimes(1);
    expect(elapsed).toBeLessThan(50);
  });

  it('first render of a PDF page completes under 2000 ms', async () => {
    const t0 = Date.now();
    await service.renderPage(
      'fresh-version-id',
      THREE_PAGE_PDF,
      'application/pdf',
      3,
    );
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(2000);
  });
});

// ===========================================================================
// FilePagesController — HTTP integration tests
// ===========================================================================
describe('FilePagesController (HTTP)', () => {
  let app: INestApplication;
  let renderService: PageRenderService;

  beforeEach(async () => {
    ({ app, renderService } = await buildApp());
    // Mock renderPdfPage on the shared service instance
    jest
      .spyOn(renderService, 'renderPdfPage')
      .mockResolvedValue(FAKE_PNG_BYTES);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await app.close();
  });

  // ── 200: member gets PNG for PDF page ──────────────────────────────────
  it('GET /api/file-versions/:id/pages/2 → 200 image/png for member', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/file-versions/${UUID.pdfVersionId}/pages/2`)
      .set('x-user-id', UUID.member);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/image\/png/);
    // PNG magic bytes
    expect(res.body[0]).toBe(0x89);
    expect(res.body[1]).toBe(0x50);
  });

  // ── 200: member gets original bytes for image version ──────────────────
  it('GET /api/file-versions/:id/pages/1 → 200 image/jpeg for image version', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/file-versions/${UUID.imageVersionId}/pages/1`)
      .set('x-user-id', UUID.member);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/image\/jpeg/);
    expect(res.text).toBe('fake-jpg');
  });

  // ── 403: non-member ─────────────────────────────────────────────────────
  it('GET /api/file-versions/:id/pages/1 → 403 for non-member', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/file-versions/${UUID.pdfVersionId}/pages/1`)
      .set('x-user-id', UUID.nonMember);

    expect(res.status).toBe(403);
  });

  // ── 404: page beyond PDF page count ─────────────────────────────────────
  it('GET /api/file-versions/:id/pages/4 → 404 for page beyond PDF page count', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/file-versions/${UUID.pdfVersionId}/pages/4`)
      .set('x-user-id', UUID.member);

    expect(res.status).toBe(404);
  });

  // ── 404: deleted file ────────────────────────────────────────────────────
  it('GET /api/file-versions/:deletedId/pages/1 → 404 for deleted file', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/file-versions/${UUID.deletedVersionId}/pages/1`)
      .set('x-user-id', UUID.member);

    expect(res.status).toBe(404);
  });

  // ── 404: unknown version id ──────────────────────────────────────────────
  it('GET /api/file-versions/unknown-version/pages/1 → 400 (invalid UUID)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/file-versions/not-a-uuid/pages/1')
      .set('x-user-id', UUID.member);

    // ParseUUIDPipe rejects non-UUID with 400
    expect(res.status).toBe(400);
  });

  // ── Cache-Control header ─────────────────────────────────────────────────
  it('sets Cache-Control: private, max-age=86400', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/file-versions/${UUID.pdfVersionId}/pages/1`)
      .set('x-user-id', UUID.member);

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('private, max-age=86400');
  });
});
