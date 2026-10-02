/**
 * Tests for PageRenderService and FilePagesController.
 *
 * Service tests use the real pdfjs-dist + @napi-rs/canvas against a 3-page PDF
 * fixture to prove actual rendering. Controller tests mock both the Minio and
 * the PageRenderService so they stay fast and don't depend on PDF libraries.
 */
import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import type { INestApplication } from '@nestjs/common';
import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request = require('supertest');
import { PrismaService } from '../../../prisma/prisma.service';
import { MinioService } from '../../../lib/integrations/minio.service';
import { FilePagesController } from './file-pages.controller';
import { PageRenderService } from './page-render.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ─── Fixture ─────────────────────────────────────────────────────────────────

const FIXTURE_PDF = fs.readFileSync(
  path.join(__dirname, '__fixtures__/three-pages.pdf'),
);

// A minimal 1×1 JPEG (valid JPEG bytes)
const JPEG_BYTES = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
  0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
]);

// ─── UUID constants ───────────────────────────────────────────────────────────

const UUID = {
  pdfVersion: '00000000-0000-0000-0000-000000000001',
  imgVersion: '00000000-0000-0000-0000-000000000002',
  deletedVersion: '00000000-0000-0000-0000-000000000003',
  member: '00000000-0000-0000-0000-000000000010',
  nonMember: '00000000-0000-0000-0000-000000000011',
  project: '00000000-0000-0000-0000-000000000020',
};

// ─────────────────────────────────────────────────────────────────────────────
// PageRenderService — unit tests using real pdfjs + canvas
// ─────────────────────────────────────────────────────────────────────────────

describe('PageRenderService', () => {
  let service: PageRenderService;

  beforeEach(() => {
    service = new PageRenderService();
  });

  it('returns PNG for page 2 of a real 3-page PDF fixture', async () => {
    const result = await service.renderPage(UUID.pdfVersion, FIXTURE_PDF, 'application/pdf', 2);
    expect(result.contentType).toBe('image/png');
    // PNG magic bytes: 89 50 4E 47
    expect(result.body[0]).toBe(0x89);
    expect(result.body[1]).toBe(0x50);
    expect(result.body[2]).toBe(0x4e);
    expect(result.body[3]).toBe(0x47);
  }, 10_000);

  it('throws 404 for page 4 (beyond 3-page PDF)', async () => {
    await expect(
      service.renderPage(UUID.pdfVersion + '-other', FIXTURE_PDF, 'application/pdf', 4),
    ).rejects.toThrow(NotFoundException);
  });

  it('throws 404 for page 0 (below valid range)', async () => {
    await expect(
      service.renderPage(UUID.pdfVersion + '-other2', FIXTURE_PDF, 'application/pdf', 0),
    ).rejects.toThrow(NotFoundException);
  });

  it('returns original bytes for image/* version (page 1)', async () => {
    const result = await service.renderPage(UUID.imgVersion, JPEG_BYTES, 'image/jpeg', 1);
    expect(result.contentType).toBe('image/jpeg');
    expect(result.body).toEqual(JPEG_BYTES);
  });

  it('throws 404 for image/* when page > 1', async () => {
    await expect(
      service.renderPage(UUID.imgVersion + '-other', JPEG_BYTES, 'image/jpeg', 2),
    ).rejects.toThrow(NotFoundException);
  });

  it('serves the second render from cache (< 50 ms)', async () => {
    // First render to populate cache
    await service.renderPage(UUID.pdfVersion + '-cache', FIXTURE_PDF, 'application/pdf', 1);
    // Second render should come from cache
    const start = Date.now();
    await service.renderPage(UUID.pdfVersion + '-cache', FIXTURE_PDF, 'application/pdf', 1);
    expect(Date.now() - start).toBeLessThan(50);
  }, 10_000);

  it('first render of a PDF page completes under 2000 ms', async () => {
    const start = Date.now();
    await service.renderPage(UUID.pdfVersion + '-timing', FIXTURE_PDF, 'application/pdf', 3);
    expect(Date.now() - start).toBeLessThan(2000);
  }, 10_000);
});

// ─────────────────────────────────────────────────────────────────────────────
// FilePagesController — HTTP tests with mocked dependencies
// ─────────────────────────────────────────────────────────────────────────────

// Fake PNG buffer with valid PNG magic bytes
const FAKE_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function makeFakePrisma() {
  const fileVersions: Record<string, any> = {
    [UUID.pdfVersion]: {
      id: UUID.pdfVersion,
      file_id: 'file-pdf',
      storage_key: 'pdfs/file.pdf',
      file: {
        id: 'file-pdf',
        project_id: UUID.project,
        mime_type: 'application/pdf',
        deleted_at: null,
      },
    },
    [UUID.imgVersion]: {
      id: UUID.imgVersion,
      file_id: 'file-img',
      storage_key: 'images/file.jpg',
      file: {
        id: 'file-img',
        project_id: UUID.project,
        mime_type: 'image/jpeg',
        deleted_at: null,
      },
    },
    [UUID.deletedVersion]: {
      id: UUID.deletedVersion,
      file_id: 'file-deleted',
      storage_key: 'pdfs/deleted.pdf',
      file: {
        id: 'file-deleted',
        project_id: UUID.project,
        mime_type: 'application/pdf',
        deleted_at: new Date('2025-01-01'),
      },
    },
  };

  const projectMembers: Array<{ project_id: string; user_id: string }> = [
    { project_id: UUID.project, user_id: UUID.member },
  ];

  return {
    file_versions: {
      findUnique: jest.fn(async ({ where, include }: any) => {
        const fv = fileVersions[where.id];
        if (!fv) return null;
        if (include?.file) return { ...fv };
        const { file: _f, ...rest } = fv;
        return rest;
      }),
    },
    project_members: {
      findFirst: jest.fn(async ({ where }: any) =>
        projectMembers.find(
          (m) => m.project_id === where.project_id && m.user_id === where.user_id,
        ) ?? null,
      ),
    },
  };
}

describe('FilePagesController (HTTP)', () => {
  let app: INestApplication;
  let pageRenderMock: { renderPage: jest.Mock };
  let minioMock: { getObjectBuffer: jest.Mock };
  let prismaMock: ReturnType<typeof makeFakePrisma>;

  beforeEach(async () => {
    prismaMock = makeFakePrisma();

    minioMock = {
      getObjectBuffer: jest.fn().mockResolvedValue(FIXTURE_PDF),
    };

    pageRenderMock = {
      renderPage: jest.fn(),
    };

    const mod = await Test.createTestingModule({
      controllers: [FilePagesController],
      providers: [
        { provide: PrismaService, useValue: prismaMock },
        { provide: MinioService, useValue: minioMock },
        { provide: PageRenderService, useValue: pageRenderMock },
      ],
    }).compile();

    app = mod.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const get = (url: string, userId?: string) => {
    const req = request(app.getHttpServer()).get(url);
    if (userId) req.set('x-user-id', userId);
    return req;
  };

  it('GET /api/file-versions/:id/pages/2 → 200 image/png for member', async () => {
    pageRenderMock.renderPage.mockResolvedValue({ contentType: 'image/png', body: FAKE_PNG });

    const res = await get(`/api/file-versions/${UUID.pdfVersion}/pages/2`, UUID.member);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/image\/png/);
    expect(Buffer.from(res.body)).toEqual(FAKE_PNG);
  });

  it('GET /api/file-versions/:id/pages/1 → 200 image/jpeg for image version', async () => {
    minioMock.getObjectBuffer.mockResolvedValue(JPEG_BYTES);
    pageRenderMock.renderPage.mockResolvedValue({ contentType: 'image/jpeg', body: JPEG_BYTES });

    const res = await get(`/api/file-versions/${UUID.imgVersion}/pages/1`, UUID.member);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/image\/jpeg/);
  });

  it('GET /api/file-versions/:id/pages/1 → 403 for non-member', async () => {
    const res = await get(`/api/file-versions/${UUID.pdfVersion}/pages/1`, UUID.nonMember);
    expect(res.status).toBe(403);
  });

  it('GET /api/file-versions/:id/pages/4 → 404 for page beyond PDF page count', async () => {
    pageRenderMock.renderPage.mockRejectedValue(new NotFoundException('Page 4 out of range'));

    const res = await get(`/api/file-versions/${UUID.pdfVersion}/pages/4`, UUID.member);
    expect(res.status).toBe(404);
  });

  it('GET /api/file-versions/:deletedId/pages/1 → 404 for deleted file', async () => {
    const res = await get(`/api/file-versions/${UUID.deletedVersion}/pages/1`, UUID.member);
    expect(res.status).toBe(404);
  });

  it('GET /api/file-versions/unknown-version/pages/1 → 400 (invalid UUID)', async () => {
    const res = await get('/api/file-versions/unknown-version/pages/1', UUID.member);
    expect(res.status).toBe(400);
  });

  it('sets Cache-Control: private, max-age=86400', async () => {
    pageRenderMock.renderPage.mockResolvedValue({ contentType: 'image/png', body: FAKE_PNG });

    const res = await get(`/api/file-versions/${UUID.pdfVersion}/pages/1`, UUID.member);

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('private, max-age=86400');
  });
});
