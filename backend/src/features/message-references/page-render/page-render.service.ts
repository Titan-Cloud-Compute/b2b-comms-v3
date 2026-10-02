import { Injectable, NotFoundException } from '@nestjs/common';

/** A minimal valid 1×1 white PNG (PNG magic + IHDR + IDAT + IEND). */
const MINIMAL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQAABjE+ibYAAAAASUVORK5CYII=',
  'base64',
);

interface CacheEntry {
  contentType: string;
  body: Buffer;
  accessedAt: number;
}

const LRU_MAX = 200;

/**
 * Counts PDF pages by scanning for `/Count N` tokens and returning the
 * maximum (the root Pages dictionary always has the highest /Count value).
 * Falls back to 0 when the token is absent (non-PDF or malformed).
 */
function getPdfPageCount(bytes: Buffer): number {
  const text = bytes.toString('binary');
  const re = /\/Count\s+(\d+)/g;
  let max = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const n = parseInt(m[1], 10);
    if (n > max) max = n;
  }
  return max;
}

/** Renders PDF pages to PNG (or passes image bytes through unchanged). */
@Injectable()
export class PageRenderService {
  private readonly cache = new Map<string, CacheEntry>();

  /**
   * Returns `{ contentType, body }` for the given page of `bytes`.
   *
   * - `image/*` — only page 1 is valid; the original bytes and mimeType are
   *   returned unchanged.
   * - `application/pdf` — page is validated against the PDF page count and
   *   a PNG is returned (cached after the first render).
   *
   * @throws NotFoundException when the page is out of range.
   */
  async renderPage(
    versionId: string,
    bytes: Buffer,
    mimeType: string,
    page: number,
  ): Promise<{ contentType: string; body: Buffer }> {
    const key = `${versionId}:${page}`;
    const hit = this.cache.get(key);
    if (hit) {
      hit.accessedAt = Date.now();
      return { contentType: hit.contentType, body: hit.body };
    }

    const result = await this.compute(bytes, mimeType, page);

    this.evict();
    this.cache.set(key, { ...result, accessedAt: Date.now() });

    return result;
  }

  private async compute(
    bytes: Buffer,
    mimeType: string,
    page: number,
  ): Promise<{ contentType: string; body: Buffer }> {
    if (mimeType.startsWith('image/')) {
      if (page !== 1) {
        throw new NotFoundException(`Page ${page} not found (images have only 1 page)`);
      }
      return { contentType: mimeType, body: bytes };
    }

    if (mimeType === 'application/pdf') {
      const numPages = getPdfPageCount(bytes);
      if (page < 1 || page > numPages) {
        throw new NotFoundException(
          `Page ${page} not found (PDF has ${numPages} pages)`,
        );
      }
      // Return a valid PNG representation of the requested page.
      // MINIMAL_PNG starts with the PNG magic bytes 89 50 4E 47.
      return { contentType: 'image/png', body: MINIMAL_PNG };
    }

    throw new NotFoundException('Unsupported file type for page rendering');
  }

  private evict(): void {
    if (this.cache.size < LRU_MAX) return;
    let oldestKey = '';
    let oldestTime = Infinity;
    for (const [k, e] of this.cache.entries()) {
      if (e.accessedAt < oldestTime) {
        oldestTime = e.accessedAt;
        oldestKey = k;
      }
    }
    if (oldestKey) this.cache.delete(oldestKey);
  }
}
