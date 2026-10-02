import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { PrismaService } from '../../../prisma/prisma.service';
import { MinioService } from '../../../lib/integrations/minio.service';
import { assertProjectMember } from '../references.access';
import { PageRenderService } from './page-render.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Serves rasterised page images for a file version.
 *
 * GET /api/file-versions/:id/pages/:page
 *
 * Responses:
 *  200  image/png  (PDF page rasterised)
 *  200  image/*    (image file original bytes)
 *  400  invalid UUID or page number
 *  403  caller is not a project member
 *  404  file version not found, file deleted, or page out of range
 */
@Controller('api/file-versions')
export class FilePagesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly minio: MinioService,
    private readonly pageRender: PageRenderService,
  ) {}

  private userId(req: Request): string {
    const id = (req.headers['x-user-id'] as string) || (req.session as any)?.userId;
    if (!id) throw new UnauthorizedException('not authenticated');
    return id;
  }

  @Get(':id/pages/:page')
  async getPage(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id', ParseUUIDPipe) versionId: string,
    @Param('page', ParseIntPipe) page: number,
  ): Promise<void> {
    const userId = this.userId(req);

    // Load file_version with its parent file
    const version: any = await (this.prisma as any).file_versions.findUnique({
      where: { id: versionId },
      include: { file: true },
    });

    if (!version || !version.file || version.file.deleted_at) {
      throw new NotFoundException('file version not found or file deleted');
    }

    const file = version.file;

    // Check project membership (throws 403 if not a member)
    await assertProjectMember(this.prisma, userId, file.project_id);

    // Fetch object bytes from object store
    const bytes = await this.minio.getObjectBuffer(version.storage_key);

    // Render / passthrough
    const { contentType, body } = await this.pageRender.renderPage(
      versionId,
      bytes,
      file.mime_type,
      page,
    );

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.status(200).end(body);
  }
}
