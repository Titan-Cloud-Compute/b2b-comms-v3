import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { ReferencesService, CreateReferenceInput, UpdateReferenceInput } from './references.service';

/**
 * References HTTP surface (no @Public — global JwtAuthGuard enforces 401):
 *   POST   /api/messages/:id/reference
 *   GET    /api/references/:id
 *   PUT    /api/references/:id
 *   DELETE /api/references/:id
 */
@UseGuards(JwtAuthGuard)
@Controller('api')
export class ReferencesController {
  constructor(private readonly refs: ReferencesService) {}

  private userId(req: Request): string {
    if (!req.session?.userId) throw new UnauthorizedException('not authenticated');
    return req.session.userId;
  }

  @Post('messages/:id/reference')
  @HttpCode(201)
  async create(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) messageId: string,
    @Body() body: CreateReferenceInput,
  ) {
    return this.refs.create(this.userId(req), messageId, body);
  }

  @Get('references/:id')
  async view(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) referenceId: string,
  ) {
    return this.refs.view(this.userId(req), referenceId);
  }

  @Put('references/:id')
  @HttpCode(200)
  async update(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) referenceId: string,
    @Body() body: UpdateReferenceInput,
  ) {
    return this.refs.update(this.userId(req), referenceId, body);
  }

  @Delete('references/:id')
  @HttpCode(204)
  async remove(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) referenceId: string,
  ): Promise<void> {
    await this.refs.remove(this.userId(req), referenceId);
  }
}
