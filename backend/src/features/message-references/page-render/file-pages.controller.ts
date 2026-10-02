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
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../../../auth/jwt-auth.guard';
import { PrismaService } from '../../../prisma/prisma.service';
import { MinioService } from '../../../lib/integrations/minio.service';
import { assertProjectMember } from '../references.access';
import { PageRenderService } from './page-render.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * GET /api/file-versions/:id/pages/:page
 *
 * Returns the page of a file version as an image:
 *  - application/pdf  → image/png  (rasterised at ~1600 px long edge)
 *  - image/*          → original bytes with original content-type
 *
 * Access: the requesting user must be a member of the project that owns
 * the file.  Non-members receive 403; deleted files return 404.
 */
@UseGuards(JwtAuthGuard)
@Controller('api')
export class FilePagesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly minio: MinioService,
    private readonly pageRender: PageRenderService,
  ) {}

  private userId(req: Request): string {
    if (!(req as any).session?.userId) {
      throw new UnauthorizedException('not authenticated');
    }
    return (req as any).session.userId as string;
  }

  @Get('file-versions/:id/pages/:page')
  async getPage(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id', ParseUUIDPipe) versionId: string,
    @Param('page', ParseIntPipe) page: number,
  ): Promise<void> {
    const userId = this.userId(req);

    // Load the file version together with its parent file.
    const version: any = await (this.prisma as any).file_versions.findUnique({
      where: { id: versionId },
      include: { files: true },
    });

    if (!version || !version.files) {
      throw new NotFoundException('file version not found');
    }

    const file: any = version.files;
    if (file.deleted_at !== null && file.deleted_at !== undefined) {
      throw new NotFoundException('file has been deleted');
    }

    // Authorise: caller must be a member of the owning project.
    await assertProjectMember(this.prisma, userId, file.project_id);

    // Fetch the raw bytes from object storage.
    const bytes = await this.minio.getObjectBuffer(version.storage_key as string);

    // Render (or pass through) the requested page.
    const { contentType, body } = await this.pageRender.renderPage(
      versionId,
      bytes,
      file.mime_type as string,
      page,
    );

    res
      .set({
        'Content-Type': contentType,
        'Cache-Control': 'private, max-age=86400',
        'Content-Length': String(body.length),
      })
      .status(200)
      .send(body);
  }
}
