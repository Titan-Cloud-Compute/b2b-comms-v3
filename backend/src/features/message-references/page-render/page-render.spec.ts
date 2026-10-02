import 'reflect-metadata';
import { readFileSync } from 'fs';
import { join } from 'path';
import { NotFoundException, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as express from 'express';
import request = require('supertest');
import { JwtAuthGuard } from '../../../auth/jwt-auth.guard';
import { MinioService } from '../../../lib/integrations/minio.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { FilePagesController } from './file-pages.controller';
import { PageRenderService } from './page-render.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ─── Fixtures ────────────────────────────────────────────────────────────────

const PDF_FIXTURE = readFileSync(
  join(__dirname, '__fixtures__/three-pages.pdf'),
);
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

// ─── IDs used across tests ────────────────────────────────────────────────────

const VERSION_ID         = '11111111-0000-0000-0000-000000000001';
const IMG_VERSION_ID     = '11111111-0000-0000-0000-000000000002';
const DELETED_VERSION_ID = '11111111-0000-0000-0000-000000000003';
const MISSING_VERSION_ID = '11111111-0000-0000-0000-000000000099';
const PROJECT_ID         = '22222222-0000-0000-0000-000000000001';
const MEMBER_ID          = '33333333-0000-0000-0000-000000000001';
const OUTSIDER_ID        = '33333333-0000-0000-0000-000000000002';

const SMALL_PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG magic
  0x00, 0x00, 0x00, 0x00, // placeholder IHDR
]);

// ─── Fake Prisma ─────────────────────────────────────────────────────────────

function makeFakePrisma() {
  const versions: Record<string, any> = {
    [VERSION_ID]: {
      id: VERSION_ID,
      storage_key: 'pdf-key',
      file: {
        id: 'file-1',
        project_id: PROJECT_ID,
        mime_type: 'application/pdf',
        deleted_at: null,
      },
    },
    [IMG_VERSION_ID]: {
      id: IMG_VERSION_ID,
      storage_key: 'img-key',
      file: {
        id: 'file-2',
        project_id: PROJECT_ID,
        mime_type: 'image/png',
        deleted_at: null,
      },
    },
    [DELETED_VERSION_ID]: {
      id: DELETED_VERSION_ID,
      storage_key: 'del-key',
      file: {
        id: 'file-3',
        project_id: PROJECT_ID,
        mime_type: 'application/pdf',
        deleted_at: new Date('2024-01-01'),
      },
    },
  };

  const members: any[] = [
    { project_id: PROJECT_ID, user_id: MEMBER_ID },
  ];

  return {
    file_versions: {
      findUnique: jest.fn(async ({ where, include }: any) => {
        void include; // include is handled manually above
        return versions[where.id] ?? null;
      }),
    },
    project_members: {
      findFirst: jest.fn(async ({ where }: any) =>
        members.find(
          (m) => m.project_id === where.project_id && m.user_id === where.user_id,
        ) ?? null,
      ),
    },
  };
}

// ─── Fake MinioService ────────────────────────────────────────────────────────

function makeFakeMinio(pdfBytes: Buffer, imgBytes: Buffer) {
  return {
    getObjectBuffer: jest.fn(async (key: string) => {
      if (key === 'pdf-key') return pdfBytes;
      if (key === 'img-key') return imgBytes;
      throw new Error('unexpected key: ' + key);
    }),
  };
}

// ─── Session stub ─────────────────────────────────────────────────────────────

const sessions: Record<string, any> = {
  member:   { userId: MEMBER_ID },
  outsider: { userId: OUTSIDER_ID },
};

// ─── PageRenderService unit tests ─────────────────────────────────────────────

describe('PageRenderService', () => {
  let service: PageRenderService;

  beforeEach(() => {
    service = new PageRenderService();
  });

  it('fixture PDF page 2 returns a buffer starting with PNG magic bytes', async () => {
    const result = await service.renderPage(VERSION_ID, PDF_FIXTURE, 'application/pdf', 2);
    expect(result.contentType).toBe('image/png');
    expect(result.body.subarray(0, 4)).toEqual(PNG_MAGIC);
  });

  it('fixture PDF page 4 (beyond 3-page count) throws NotFoundException', async () => {
    await expect(
      service.renderPage(VERSION_ID, PDF_FIXTURE, 'application/pdf', 4),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('image mimeType page 1 returns the original bytes unchanged', async () => {
    const imgBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe]);
    const result = await service.renderPage(IMG_VERSION_ID, imgBytes, 'image/png', 1);
    expect(result.contentType).toBe('image/png');
    expect(result.body).toEqual(imgBytes);
  });

  it('image mimeType page > 1 throws NotFoundException', async () => {
    await expect(
      service.renderPage(IMG_VERSION_ID, Buffer.from([1, 2, 3]), 'image/jpeg', 2),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('cached: first render < 2 s, second render < 50 ms (cache hit)', async () => {
    const CACHE_VERSION = '55555555-0000-0000-0000-000000000001';
    const t0 = Date.now();
    await service.renderPage(CACHE_VERSION, PDF_FIXTURE, 'application/pdf', 1);
    const firstMs = Date.now() - t0;
    expect(firstMs).toBeLessThan(2000);

    const t1 = Date.now();
    await service.renderPage(CACHE_VERSION, PDF_FIXTURE, 'application/pdf', 1);
    const secondMs = Date.now() - t1;
    expect(secondMs).toBeLessThan(50);
  });
});

// ─── FilePagesController HTTP tests ───────────────────────────────────────────

describe('FilePagesController', () => {
  let app: INestApplication;
  let fakePrisma: ReturnType<typeof makeFakePrisma>;
  let fakeMinio: ReturnType<typeof makeFakeMinio>;

  beforeEach(async () => {
    fakePrisma = makeFakePrisma();
    fakeMinio = makeFakeMinio(PDF_FIXTURE, SMALL_PNG);

    const mod = await Test.createTestingModule({
      controllers: [FilePagesController],
      providers: [
        PageRenderService,
        { provide: PrismaService, useValue: fakePrisma },
        { provide: MinioService, useValue: fakeMinio },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: any) => {
          const req = ctx.switchToHttp().getRequest();
          const who = req.headers['x-test-user'];
          if (!who || !sessions[who]) {
            throw new NotFoundException('not found');
          }
          req.session = sessions[who];
          return true;
        },
      })
      .compile();

    app = mod.createNestApplication({ bodyParser: false });
    app.use(express.json());
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const as = (who: string) => ({
    get: (url: string) =>
      request(app.getHttpServer()).get(url).set('x-test-user', who),
  });

  it('200 image/png for a member requesting page 2 of a PDF fixture', async () => {
    const res = await as('member').get(
      `/api/file-versions/${VERSION_ID}/pages/2`,
    );
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/image\/png/);
    expect(Buffer.from(res.body).subarray(0, 4)).toEqual(PNG_MAGIC);
    expect(res.headers['cache-control']).toMatch(/private/);
  });

  it('200 with original image bytes for an image version (page 1)', async () => {
    const res = await as('member').get(
      `/api/file-versions/${IMG_VERSION_ID}/pages/1`,
    );
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/image\/png/);
  });

  it('403 for a non-member', async () => {
    const res = await as('outsider').get(
      `/api/file-versions/${VERSION_ID}/pages/1`,
    );
    expect(res.status).toBe(403);
  });

  it('404 for a page beyond the PDF page count', async () => {
    const res = await as('member').get(
      `/api/file-versions/${VERSION_ID}/pages/99`,
    );
    expect(res.status).toBe(404);
  });

  it('404 when the file version does not exist', async () => {
    const res = await as('member').get(
      `/api/file-versions/${MISSING_VERSION_ID}/pages/1`,
    );
    expect(res.status).toBe(404);
  });

  it('404 when the file is soft-deleted', async () => {
    const res = await as('member').get(
      `/api/file-versions/${DELETED_VERSION_ID}/pages/1`,
    );
    expect(res.status).toBe(404);
  });
});
