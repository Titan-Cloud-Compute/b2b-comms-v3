import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import { FileExplorerService, type UploadedBlob } from './file-explorer.service';

const NameSchema = z.string().trim().min(1, 'must not be blank').max(255);
const IdSchema = z.string().trim().min(1).nullable().optional();

const CreateFolderSchema = z.object({ name: NameSchema, parent_id: IdSchema });
const UpdateFolderSchema = z.object({ name: NameSchema.optional(), parent_id: IdSchema });
const UpdateFileSchema = z.object({ name: NameSchema.optional(), folder_id: IdSchema });

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body ?? {});
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue?.path.join('.') || 'body';
    throw new BadRequestException(`${field}: ${issue?.message ?? 'invalid'}`);
  }
  return result.data;
}

type SessionReq = Request & { session?: { userId: string; role: string } };

@ApiTags('files')
@Controller('api')
export class FileExplorerController {
  constructor(private readonly svc: FileExplorerService) {}

  private actor(req: Request) {
    return this.svc.resolveActor((req as SessionReq).session);
  }

  @Get('projects/:id/files')
  async list(
    @Req() req: Request,
    @Param('id') id: string,
    @Query('folder_id') folderId?: string,
    @Query('q') q?: string,
  ) {
    const actor = await this.actor(req);
    return this.svc.list(actor, id, folderId || null, q);
  }

  @Post('projects/:id/files')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(AnyFilesInterceptor())
  async upload(
    @Req() req: Request,
    @Param('id') id: string,
    @UploadedFiles() files: UploadedBlob[] | undefined,
    @Body() body: { folder_id?: string } | undefined,
  ) {
    const actor = await this.actor(req);
    return this.svc.upload(actor, id, body?.folder_id || null, files ?? []);
  }

  @Get('files/:id/download')
  async download(@Req() req: Request, @Param('id') id: string, @Query('version_id') versionId?: string) {
    const actor = await this.actor(req);
    return this.svc.download(actor, id, versionId);
  }

  @Get('files/:id/versions')
  async versions(@Req() req: Request, @Param('id') id: string) {
    const actor = await this.actor(req);
    return this.svc.versions(actor, id);
  }

  @Patch('files/:id')
  async updateFile(@Req() req: Request, @Param('id') id: string, @Body() body: unknown) {
    const actor = await this.actor(req);
    return this.svc.updateFile(actor, id, parse(UpdateFileSchema, body));
  }

  @Delete('files/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteFile(@Req() req: Request, @Param('id') id: string) {
    const actor = await this.actor(req);
    await this.svc.deleteFile(actor, id);
  }

  @Post('projects/:id/folders')
  @HttpCode(HttpStatus.CREATED)
  async createFolder(@Req() req: Request, @Param('id') id: string, @Body() body: unknown) {
    const actor = await this.actor(req);
    return this.svc.createFolder(actor, id, parse(CreateFolderSchema, body));
  }

  @Patch('folders/:id')
  async updateFolder(@Req() req: Request, @Param('id') id: string, @Body() body: unknown) {
    const actor = await this.actor(req);
    return this.svc.updateFolder(actor, id, parse(UpdateFolderSchema, body));
  }

  @Delete('folders/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteFolder(@Req() req: Request, @Param('id') id: string) {
    const actor = await this.actor(req);
    await this.svc.deleteFolder(actor, id);
  }
}
