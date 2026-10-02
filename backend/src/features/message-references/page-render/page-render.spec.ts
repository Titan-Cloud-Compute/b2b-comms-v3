import 'reflect-metadata';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { countPdfPages, PageRenderService } from './page-render.service';
import { PNG_SIGNATURE, solidPng } from './png';

/* eslint-disable @typescript-eslint/no-explicit-any */

const V_PDF = '11111111-1111-4111-8111-111111111111';
const V_IMG = '22222222-2222-4222-8222-222222222222';
const V_DOC = '33333333-3333-4333-8333-333333333333';
const V_DEL = '44444444-4444-4444-8444-444444444444';

const pdfBytes = Buffer.from(
  '%PDF-1.4\n1 0 obj << /Type /Pages /Count 3 >> endobj\n' +
    '2 0 obj << /Type /Page >> endobj\n3 0 obj << /Type /Page >> endobj\n4 0 obj << /Type/Page >> endobj\n%%EOF',
  'latin1',
);
const pngBytes = solidPng(4, 4, [0, 0, 0]);

function setup(member = true) {
  const versions: Record<string, any> = {
    [V_PDF]: { id: V_PDF, storage_key: 'k-pdf', file: { project_id: 'p1', mime_type: 'application/pdf', deleted_at: null } },
    [V_IMG]: { id: V_IMG, storage_key: 'k-img', file: { project_id: 'p1', mime_type: 'image/png', deleted_at: null } },
    [V_DOC]: { id: V_DOC, storage_key: 'k-doc', file: { project_id: 'p1', mime_type: 'application/msword', deleted_at: null } },
    [V_DEL]: { id: V_DEL, storage_key: 'k-del', file: { project_id: 'p1', mime_type: 'application/pdf', deleted_at: new Date() } },
  };
  const prisma: any = {
    file_versions: { findUnique: jest.fn(async ({ where }: any) => versions[where.id] ?? null) },
    project_members: { findUnique: jest.fn(async () => (member ? { project_id: 'p1', user_id: 'u1' } : null)) },
  };
  const minio: any = {
    getObjectBuffer: jest.fn(async (key: string) => (key === 'k-img' ? pngBytes : pdfBytes)),
  };
  const svc = new PageRenderService(prisma, minio);
  return { svc, prisma, minio };
}

describe('page render', () => {
  it('encodes a valid PNG', () => {
    const png = solidPng(2, 3);
    expect(png.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
    expect(png.readUInt32BE(16)).toBe(2);
    expect(png.readUInt32BE(20)).toBe(3);
  });

  it('counts PDF pages', () => {
    expect(countPdfPages(pdfBytes)).toBe(3);
  });

  it('renders a PDF page to PNG via the rasteriser', async () => {
    const { svc } = setup();
    const rendered = Buffer.from('rendered');
    svc.rasterise = jest.fn(async () => rendered);
    const out = await svc.render(V_PDF, '2', 'u1');
    expect(out.contentType).toBe('image/png');
    expect(out.body).toBe(rendered);
    expect(svc.rasterise).toHaveBeenCalledWith(pdfBytes, 2);
  });

  it('falls back to a blank PNG page when no rasteriser is available', async () => {
    const { svc } = setup();
    svc.rasterise = jest.fn(async () => null);
    const out = await svc.render(V_PDF, '1', 'u1');
    expect(out.contentType).toBe('image/png');
    expect(out.body.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
  });

  it('serves images directly', async () => {
    const { svc } = setup();
    const out = await svc.render(V_IMG, '1', 'u1');
    expect(out.contentType).toBe('image/png');
    expect(out.body).toBe(pngBytes);
  });

  it('caches rendered pages', async () => {
    const { svc, minio } = setup();
    svc.rasterise = jest.fn(async () => Buffer.from('x'));
    await svc.render(V_PDF, '1', 'u1');
    await svc.render(V_PDF, '1', 'u1');
    expect(minio.getObjectBuffer).toHaveBeenCalledTimes(1);
  });

  it('rejects out-of-range and invalid pages with 400', async () => {
    const { svc } = setup();
    svc.rasterise = jest.fn(async () => null);
    await expect(svc.render(V_PDF, '9', 'u1')).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.render(V_PDF, '0', 'u1')).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.render(V_PDF, 'abc', 'u1')).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.render(V_IMG, '2', 'u1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects non-PDF/image files with 400', async () => {
    const { svc } = setup();
    await expect(svc.render(V_DOC, '1', 'u1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects non-members with 403', async () => {
    const { svc } = setup(false);
    await expect(svc.render(V_PDF, '1', 'u1')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.render(V_PDF, '1', undefined)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('returns 404 for unknown versions and deleted files', async () => {
    const { svc } = setup();
    await expect(svc.render('nope', '1', 'u1')).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.render(V_DEL, '1', 'u1')).rejects.toBeInstanceOf(NotFoundException);
  });
});
