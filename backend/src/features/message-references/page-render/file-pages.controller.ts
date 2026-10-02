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
import { MinioService } from '../../../lib/integrations/minio.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { assertProjectMember } from '../references.access';
import { PageRenderService } from './page-render.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Serves rendered page images for file versions.
 *   GET /api/file-versions/:id/pages/:page
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
    @Param('id', ParseUUIDPipe) id: string,
    @Param('page', ParseIntPipe) page: number,
  ): Promise<void> {
    const userId = this.userId(req);
    const db = this.prisma as any;

    const version = await db.file_versions.findUnique({
      where: { id },
      include: { file: true },
    });

    if (!version || !version.file || version.file.deleted_at !== null) {
      throw new NotFoundException('File version not found');
    }

    const file = version.file;
    await assertProjectMember(db, userId, file.project_id);

    const bytes = await this.minio.getObjectBuffer(version.storage_key);

    const { contentType, body } = await this.pageRender.renderPage(
      id,
      bytes,
      file.mime_type,
      page,
    );

    res.set({
      'Content-Type': contentType,
      'Cache-Control': 'private, max-age=86400',
    });
    res.send(body);
  }
}
