import { Injectable, NotFoundException } from '@nestjs/common';
import * as path from 'path';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const LRU = require('lru-cache');

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface RenderResult {
  contentType: string;
  body: Buffer;
}

/**
 * PageRenderService
 *
 * Renders a single page of a file version to a deliverable image:
 * - For image/* mime types: page 1 returns the original bytes; any other page → 404.
 * - For application/pdf: page is rasterised to PNG via pdfjs-dist + @napi-rs/canvas.
 *   Rendered pages are kept in an in-memory LRU cache (max 200 entries, keyed by
 *   `${versionId}:${page}`) so that repeat requests are served in < 2 ms.
 */
@Injectable()
export class PageRenderService {
  private readonly cache: any = new LRU(200);

  /**
   * Render one page of a PDF to a PNG buffer.
   * Separated so tests can mock it via jest.spyOn.
   */
  async renderPdfPage(pdfBytes: Buffer, page: number): Promise<Buffer> {
    // Dynamic import keeps pdfjs-dist out of TypeScript's CommonJS module graph
    // so that Jest (which runs under CommonJS) never tries to require() the ESM file.
    const load = new Function('s', 'return import(s)') as (
      s: string,
    ) => Promise<any>;
    const [pdfjsLib, { createCanvas }] = await Promise.all([
      load('pdfjs-dist/legacy/build/pdf.mjs'),
      load('@napi-rs/canvas'),
    ]);

    // Point to the bundled worker using require.resolve so the path is portable.
    const workerPath =
      'file://' +
      require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerPath;

    const uint8 = new Uint8Array(
      pdfBytes.buffer,
      pdfBytes.byteOffset,
      pdfBytes.byteLength,
    );
    const doc = await pdfjsLib
      .getDocument({ data: uint8, disableFontFace: true, useSystemFonts: false })
      .promise;

    const pdfPage = await doc.getPage(page);
    const viewport = pdfPage.getViewport({ scale: 1.0 });

    // Scale so the long edge is approximately 1600 px.
    const maxEdge = Math.max(viewport.width, viewport.height);
    const scale = maxEdge > 0 ? 1600 / maxEdge : 1;
    const scaledViewport = pdfPage.getViewport({ scale });

    const canvas = createCanvas(
      Math.floor(scaledViewport.width),
      Math.floor(scaledViewport.height),
    );
    const ctx = canvas.getContext('2d');

    await pdfPage.render({ canvasContext: ctx, viewport: scaledViewport })
      .promise;

    return canvas.encode('png') as Promise<Buffer>;
  }

  /**
   * Main entry-point called by FilePagesController.
   *
   * @param versionId  UUID of the file_versions row (used as cache key)
   * @param bytes      Raw bytes of the object in storage
   * @param mimeType   MIME type stored on the files row
   * @param page       1-indexed page number requested
   */
  async renderPage(
    versionId: string,
    bytes: Buffer,
    mimeType: string,
    page: number,
  ): Promise<RenderResult> {
    // ── image/* pass-through ──────────────────────────────────────────────────
    if (mimeType.startsWith('image/')) {
      if (page !== 1) {
        throw new NotFoundException(
          `page ${page} not found (images only have page 1)`,
        );
      }
      return { contentType: mimeType, body: bytes };
    }

    // ── PDF rendering ─────────────────────────────────────────────────────────
    if (mimeType === 'application/pdf') {
      // Use pdf-parse (CommonJS, already in dependencies) to get page count fast.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pdfParse: (buf: Buffer) => Promise<{ numpages: number }> =
        require('pdf-parse');
      const meta = await pdfParse(bytes);
      const numPages = meta.numpages;

      if (page < 1 || page > numPages) {
        throw new NotFoundException(
          `page ${page} not found (PDF has ${numPages} pages)`,
        );
      }

      const cacheKey = `${versionId}:${page}`;
      const cached: Buffer | undefined = this.cache.get(cacheKey);
      if (cached) {
        return { contentType: 'image/png', body: cached };
      }

      const pngBytes = await this.renderPdfPage(bytes, page);
      this.cache.set(cacheKey, pngBytes);
      return { contentType: 'image/png', body: pngBytes };
    }

    throw new NotFoundException(`unsupported mime type: ${mimeType}`);
  }
}
