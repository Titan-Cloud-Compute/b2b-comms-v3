import { Controller, Get, HttpCode, HttpStatus, Param, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { GeneralChannelsService } from '../general-channels/general-channels.service';
import { UnreadMessageIndicatorsService } from './unread-message-indicators.service';

type SessionReq = Request & { session?: { userId: string; role: string } };

@ApiTags('unread')
@Controller('api')
export class UnreadMessageIndicatorsController {
  constructor(
    private readonly channels: GeneralChannelsService,
    private readonly svc: UnreadMessageIndicatorsService,
  ) {}

  /** 401 without a session (resolveActor), 403 for a project the user cannot access. */
  private actor(req: Request) {
    return this.channels.resolveActor((req as SessionReq).session);
  }

  @Get('projects/:id/unread')
  async unread(@Req() req: Request, @Param('id') id: string) {
    return this.svc.listUnread(await this.actor(req), id);
  }

  @Post('channels/:id/read')
  @HttpCode(HttpStatus.OK)
  async read(@Req() req: Request, @Param('id') id: string) {
    return this.svc.markRead(await this.actor(req), id);
  }
}
