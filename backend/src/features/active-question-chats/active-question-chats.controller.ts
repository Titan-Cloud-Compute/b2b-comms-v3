import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ActiveQuestionChatsService, type CreateQuestionInput } from './active-question-chats.service';

type SessionReq = Request & { session?: { userId: string; role: string } };

@ApiTags('questions')
@Controller('api')
export class ActiveQuestionChatsController {
  constructor(private readonly svc: ActiveQuestionChatsService) {}

  private actor(req: Request) {
    return this.svc.resolveActor((req as SessionReq).session);
  }

  @Get('projects/:id/questions')
  async list(@Req() req: Request, @Param('id') id: string) {
    return this.svc.list(await this.actor(req), id);
  }

  @Post('projects/:id/questions')
  @HttpCode(HttpStatus.CREATED)
  async create(@Req() req: Request, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.create(await this.actor(req), id, (body ?? {}) as CreateQuestionInput);
  }

  @Post('questions/:id/resolve')
  @HttpCode(HttpStatus.OK)
  async resolve(@Req() req: Request, @Param('id') id: string) {
    return this.svc.resolve(await this.actor(req), id);
  }

  @Delete('questions/:id/resolve')
  @HttpCode(HttpStatus.OK)
  async withdraw(@Req() req: Request, @Param('id') id: string) {
    return this.svc.withdraw(await this.actor(req), id);
  }
}
