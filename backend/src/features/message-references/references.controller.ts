import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { ReferencesService } from './references.service';

@UseGuards(JwtAuthGuard)
@Controller('api/messages')
export class MessageReferencesController {
  constructor(private readonly svc: ReferencesService) {}

  @Post(':id/reference')
  @HttpCode(201)
  create(@Param('id') messageId: string, @Req() req: Request, @Body() body: unknown) {
    return this.svc.create(messageId, req.session?.userId, body);
  }
}

@UseGuards(JwtAuthGuard)
@Controller('api/references')
export class ReferencesController {
  constructor(private readonly svc: ReferencesService) {}

  @Get(':id')
  get(@Param('id') id: string, @Req() req: Request) {
    return this.svc.get(id, req.session?.userId);
  }

  @Put(':id')
  update(@Param('id') id: string, @Req() req: Request, @Body() body: unknown) {
    return this.svc.update(id, req.session?.userId, body);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string, @Req() req: Request): Promise<void> {
    await this.svc.remove(id, req.session?.userId);
  }
}
