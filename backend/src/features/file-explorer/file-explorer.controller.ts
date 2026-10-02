import {
  ArgumentsHost,
  BadRequestException,
  Body,
  Catch,
  ExceptionFilter,
  PayloadTooLargeException,
  UseFilters,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { FileExplorerService, MAX_UPLOAD_BYTES, UploadInput } from './file-explorer.service';

/** Multer's size-limit rejection (413) is reported as the card's 400 validation error. */
@Catch(PayloadTooLargeException)
export class UploadTooLargeFilter implements ExceptionFilter {
  catch(_exception: PayloadTooLargeException, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const err = new BadRequestException('File exceeds the 100 MB limit');
    res.status(400).json(err.getResponse());
  }
}

@UseGuards(JwtAuthGuard)
@Controller('api/projects')
export class ProjectFilesController {
  constructor(private readonly svc: FileExplorerService) {}

  @Get(':id/files')
  list(
    @Param('id') projectId: string,
    @Req() req: Request,
    @Query('folderId') folderId?: string,
    @Query('q') q?: string,
  ) {
    return this.svc.list(projectId, req.session?.userId, folderId || null, q);
  }

  @Post(':id/files')
  @HttpCode(201)
  @UseFilters(UploadTooLargeFilter)
  @UseInterceptors(FilesInterceptor('files', 20, { limits: { fileSize: MAX_UPLOAD_BYTES + 1 } }))
  upload(
    @Param('id') projectId: string,
    @Req() req: Request,
    @UploadedFiles() files: UploadInput[],
    @Body() body: { folderId?: string },
  ) {
    return this.svc.upload(projectId, req.session?.userId, body?.folderId || null, files ?? []);
  }

  @Post(':id/folders')
  @HttpCode(201)
  createFolder(
    @Param('id') projectId: string,
    @Req() req: Request,
    @Body() body: { name?: string; parentId?: string | null },
  ) {
    return this.svc.createFolder(projectId, req.session?.userId, body ?? {});
  }
}

@UseGuards(JwtAuthGuard)
@Controller('api/files')
export class FilesController {
  constructor(private readonly svc: FileExplorerService) {}

  @Get(':id/download')
  download(@Param('id') id: string, @Req() req: Request) {
    return this.svc.download(id, req.session?.userId);
  }

  @Get(':id/versions')
  versions(@Param('id') id: string, @Req() req: Request) {
    return this.svc.versions(id, req.session?.userId);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Req() req: Request, @Body() body: { name?: string; folderId?: string | null }) {
    return this.svc.updateFile(id, req.session?.userId, body ?? {});
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string, @Req() req: Request): Promise<void> {
    await this.svc.deleteFile(id, req.session?.userId);
  }
}

@UseGuards(JwtAuthGuard)
@Controller('api/folders')
export class FoldersController {
  constructor(private readonly svc: FileExplorerService) {}

  @Patch(':id')
  update(@Param('id') id: string, @Req() req: Request, @Body() body: { name?: string; parentId?: string | null }) {
    return this.svc.updateFolder(id, req.session?.userId, body ?? {});
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string, @Req() req: Request): Promise<void> {
    await this.svc.deleteFolder(id, req.session?.userId);
  }
}
