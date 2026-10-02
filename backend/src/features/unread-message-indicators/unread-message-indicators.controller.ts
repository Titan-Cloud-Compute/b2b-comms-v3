import { Controller, Get, HttpCode, HttpStatus, Param, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { UnreadMessageIndicatorsService } from './unread-message-indicators.service';

type SessionReq = Request & { session?: { userId: string; role: string } };

const HEARTBEAT_MS = 25_000;

@ApiTags('unread')
@Controller('api')
export class UnreadMessageIndicatorsController {
  constructor(private readonly svc: UnreadMessageIndicatorsService) {}

  private actor(req: Request) {
    return this.svc.resolveActor((req as SessionReq).session);
  }

  @Get('projects/:id/unread')
  async counts(@Req() req: Request, @Param('id') id: string) {
    return this.svc.counts(await this.actor(req), id);
  }

  @Post('channels/:id/read')
  @HttpCode(HttpStatus.OK)
  async read(@Req() req: Request, @Param('id') id: string) {
    return this.svc.markRead(await this.actor(req), id);
  }

  /** Per-user Server-Sent Events stream of `unread.changed` events. */
  @Get('realtime/unread')
  async stream(@Req() req: Request, @Res() res: Response) {
    const actor = await this.actor(req);
    const unsubscribe = this.svc.subscribe(actor, (event) => {
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    });
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    res.write(`event: ready\ndata: {"type":"ready"}\n\n`);
    const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
    heartbeat.unref?.();
    const close = () => {
      clearInterval(heartbeat);
      unsubscribe();
    };
    req.on('close', close);
    res.on('close', close);
  }
}
