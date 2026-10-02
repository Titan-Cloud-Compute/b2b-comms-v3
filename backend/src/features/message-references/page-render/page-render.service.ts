import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { MinioService } from '../../../lib/integrations/minio.service';
import { solidPng } from './png';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface RenderedPage {
  contentType: string;
  body: Buffer;
}

/** Counts pages in a PDF by its page objects (cheap, no full parse). */
export function countPdfPages(pdf: Buffer): number {
  const text = pdf.toString('latin1');
  const matches = text.match(/\/Type\s*\/Page(?![a-zA-Z])/g);
  return matches ? matches.length : 1;
}

/** Rasterises one PDF page to PNG with poppler's pdftoppm; null if unavailable. */
export async function rasterisePdfPage(pdf: Buffer, page: number): Promise<Buffer | null> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'ref-page-'));
  const input = join(dir, `${randomUUID()}.pdf`);
  const outPrefix = join(dir, 'out');
  try {
    await fs.writeFile(input, pdf);
    await new Promise<void>((resolve, reject) => {
      execFile(
        'pdftoppm',
        ['-png', '-r', '110', '-f', String(page), '-l', String(page), '-singlefile', input, outPrefix],
        { timeout: 15000 },
        (err) => (err ? reject(err) : resolve()),
      );
    });
    return await fs.readFile(`${outPrefix}.png`);
  } catch {
    return null;
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

@Injectable()
export class PageRenderService {
  /** Rendered pages are immutable per (version, page); keep a small in-memory cache. */
  private readonly cache = new Map<string, RenderedPage>();
  private static readonly CACHE_LIMIT = 200;

  /** PDF rasteriser; replaceable in tests. */
  rasterise: (pdf: Buffer, page: number) => Promise<Buffer | null> = rasterisePdfPage;

  constructor(
    private readonly prisma: PrismaService,
    private readonly minio: MinioService,
  ) {}

  async render(versionId: string, pageParam: string, userId: string | undefined): Promise<RenderedPage> {
    if (!UUID_RE.test(versionId)) throw new NotFoundException('file version not found');
    const page = Number(pageParam);
    if (!Number.isInteger(page) || page < 1) throw new BadRequestException('page must be a positive integer');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const version: any = await this.prisma.file_versions.findUnique({
      where: { id: versionId },
      include: { file: true },
    });
    if (!version || !version.file) throw new NotFoundException('file version not found');
    if (!userId) throw new ForbiddenException('not a project member');
    const member = await this.prisma.project_members.findUnique({
      where: { project_id_user_id: { project_id: version.file.project_id, user_id: userId } },
    });
    if (!member) throw new ForbiddenException('not a project member');
    if (version.file.deleted_at) throw new NotFoundException('This file is no longer available');

    const key = `${versionId}:${page}`;
    const cached = this.cache.get(key);
    if (cached) return cached;

    const mime = String(version.file.mime_type ?? '').toLowerCase();
    let result: RenderedPage;
    if (mime.startsWith('image/')) {
      if (page !== 1) throw new BadRequestException('images have a single page');
      result = { contentType: mime, body: await this.minio.getObjectBuffer(version.storage_key) };
    } else if (mime === 'application/pdf') {
      const pdf = await this.minio.getObjectBuffer(version.storage_key);
      if (page > countPdfPages(pdf)) throw new BadRequestException('page is out of range');
      const png = await this.rasterise(pdf, page);
      // Without a rasteriser, serve a blank letter-ratio page so the overlay still renders.
      result = { contentType: 'image/png', body: png ?? solidPng(850, 1100) };
    } else {
      throw new BadRequestException('Only PDF and image files can be referenced');
    }

    if (this.cache.size >= PageRenderService.CACHE_LIMIT) {
      const first = this.cache.keys().next().value;
      if (first !== undefined) this.cache.delete(first);
    }
    this.cache.set(key, result);
    return result;
  }
}
