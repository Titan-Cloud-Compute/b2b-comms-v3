import { Injectable, NotFoundException } from '@nestjs/common';
import * as path from 'path';

export interface RenderResult {
  contentType: string;
  body: Buffer;
}

/** Simple LRU cache using insertion-order of a Map. */
class LruCache<K, V> {
  private readonly map = new Map<K, V>();
  constructor(private readonly maxSize: number) {}

  get(key: K): V | undefined {
    const val = this.map.get(key);
    if (val !== undefined) {
      // refresh entry order
      this.map.delete(key);
      this.map.set(key, val);
    }
    return val;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.maxSize) {
      const oldest = this.map.keys().next().value as K;
      this.map.delete(oldest);
    }
  }
}

@Injectable()
export class PageRenderService {
  // Cache up to 200 rendered pages keyed by `${versionId}:${page}`
  private readonly cache = new LruCache<string, RenderResult>(200);

  /**
   * Render a single page from a file version.
   *
   * - For image/* MIME types: only page 1 is valid; the original bytes are
   *   returned as-is with the original content type.
   * - For application/pdf: the page is rasterised to PNG at ~1600 px on the
   *   long edge using pdf.js + @napi-rs/canvas.
   *
   * @throws NotFoundException when page is out of range.
   */
  async renderPage(
    versionId: string,
    bytes: Buffer,
    mimeType: string,
    page: number,
  ): Promise<RenderResult> {
    const cacheKey = `${versionId}:${page}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const result = await this.doRender(bytes, mimeType, page);
    this.cache.set(cacheKey, result);
    return result;
  }

  private async doRender(
    bytes: Buffer,
    mimeType: string,
    page: number,
  ): Promise<RenderResult> {
    if (mimeType.startsWith('image/')) {
      if (page !== 1) {
        throw new NotFoundException(`Image files only have page 1; requested page ${page}`);
      }
      return { contentType: mimeType, body: bytes };
    }

    if (mimeType === 'application/pdf') {
      return this.renderPdfPage(bytes, page);
    }

    throw new NotFoundException(`Unsupported MIME type for page rendering: ${mimeType}`);
  }

  private async renderPdfPage(bytes: Buffer, page: number): Promise<RenderResult> {
    // Use new Function so TypeScript's CommonJS output does not rewrite to require()
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const load = new Function('s', 'return import(s)') as (s: string) => Promise<unknown>;

    // Resolve paths via require.resolve so they work both in source and dist
    const pkgDir = path.dirname(require.resolve('pdfjs-dist/package.json'));
    const pdfjsPath = path.join(pkgDir, 'legacy/build/pdf.mjs');
    const workerPath = path.join(pkgDir, 'legacy/build/pdf.worker.mjs');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdfjsLib = await load(`file://${pdfjsPath}`) as any;
    pdfjsLib.GlobalWorkerOptions.workerSrc = `file://${workerPath}`;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdfDoc: any = await pdfjsLib.getDocument({
      data: new Uint8Array(bytes),
      disableFontFace: true,
      useSystemFonts: false,
    }).promise;

    const numPages: number = pdfDoc.numPages;
    if (page < 1 || page > numPages) {
      throw new NotFoundException(`Page ${page} out of range (1–${numPages})`);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdfPage: any = await pdfDoc.getPage(page);
    const viewport = pdfPage.getViewport({ scale: 1.0 });

    // Scale so the long edge is ~1600 px
    const longEdge = Math.max(viewport.width, viewport.height);
    const scale = 1600 / longEdge;
    const scaledViewport = pdfPage.getViewport({ scale });

    const { createCanvas } = await import('@napi-rs/canvas');
    const canvas = createCanvas(Math.ceil(scaledViewport.width), Math.ceil(scaledViewport.height));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctx = canvas.getContext('2d') as any;

    await pdfPage.render({ canvasContext: ctx, viewport: scaledViewport }).promise;

    const png = await canvas.encode('png');
    return { contentType: 'image/png', body: png };
  }
}
