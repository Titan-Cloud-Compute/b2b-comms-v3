import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { type CreateReferenceInput, ReferencesService, type UpdateReferenceInput } from './references.service';

type SessionReq = Request & { session?: { userId: string; role: string } };

@ApiTags('references')
@Controller('api')
export class ReferencesController {
  constructor(private readonly svc: ReferencesService) {}

  private actor(req: Request) {
    return this.svc.resolveActor((req as SessionReq).session);
  }

  @Post('messages/:id/reference')
  @HttpCode(HttpStatus.CREATED)
  async create(@Req() req: Request, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.create(await this.actor(req), id, (body ?? {}) as CreateReferenceInput);
  }

  @Get('references/:id')
  async get(@Req() req: Request, @Param('id') id: string) {
    return this.svc.get(await this.actor(req), id);
  }

  @Put('references/:id')
  @HttpCode(HttpStatus.OK)
  async update(@Req() req: Request, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.update(await this.actor(req), id, (body ?? {}) as UpdateReferenceInput);
  }

  @Delete('references/:id')
  @HttpCode(HttpStatus.OK)
  async remove(@Req() req: Request, @Param('id') id: string) {
    return this.svc.remove(await this.actor(req), id);
  }

  @Get('file-versions/:id/pages/:page')
  async page(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Param('page') page: string) {
    const out = await this.svc.page(await this.actor(req), id, page);
    res.status(200);
    res.setHeader('Content-Type', out.content_type);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(out.body);
  }
}
