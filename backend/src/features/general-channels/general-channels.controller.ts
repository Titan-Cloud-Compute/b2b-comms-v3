import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { z, ZodTypeAny } from 'zod';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { ProjectsService } from '../projects/projects.service';
import { createChannelSchema, editMessageSchema, postMessageSchema } from './general-channels.policy';
import { GeneralChannelsService } from './general-channels.service';
import { RealtimeEvent, RealtimeHub } from './realtime.hub';

function parse<S extends ZodTypeAny>(schema: S, value: unknown): z.output<S> {
  const r = schema.safeParse(value ?? {});
  if (!r.success) {
    throw new BadRequestException(
      r.error.issues.map((i: { message: string }) => i.message).join('; ') || 'invalid request',
    );
  }
  return r.data as z.output<S>;
}

/**
 * General Channels HTTP surface:
 *   GET/POST /api/projects/:id/channels
 *   GET/POST /api/channels/:id/messages
 *   PATCH/DELETE /api/messages/:id
 *   GET /api/realtime/socket   (Server-Sent Events stream of message.* events)
 */
@UseGuards(JwtAuthGuard)
@Controller('api')
export class GeneralChannelsController {
  constructor(
    private readonly channels: GeneralChannelsService,
    private readonly projects: ProjectsService,
    private readonly hub: RealtimeHub,
  ) {}

  private async actor(req: Request) {
    if (!req.session) throw new UnauthorizedException('not authenticated');
    return this.projects.resolveActor(req.session);
  }

  @Get('projects/:id/channels')
  async listChannels(@Req() req: Request, @Param('id') id: string) {
    return this.channels.listChannels(await this.actor(req), id);
  }

  @Post('projects/:id/channels')
  @HttpCode(201)
  async createChannel(@Req() req: Request, @Param('id') id: string, @Body() body: unknown) {
    const actor = await this.actor(req);
    return this.channels.createChannel(actor, id, parse(createChannelSchema, body));
  }

  @Get('channels/:id/messages')
  async listMessages(@Req() req: Request, @Param('id') id: string) {
    return this.channels.listMessages(await this.actor(req), id);
  }

  @Post('channels/:id/messages')
  @HttpCode(201)
  async postMessage(@Req() req: Request, @Param('id') id: string, @Body() body: unknown) {
    const actor = await this.actor(req);
    return this.channels.postMessage(actor, id, parse(postMessageSchema, body));
  }

  @Patch('messages/:id')
  @HttpCode(200)
  async editMessage(@Req() req: Request, @Param('id') id: string, @Body() body: unknown) {
    const actor = await this.actor(req);
    return this.channels.editMessage(actor, id, parse(editMessageSchema, body));
  }

  @Delete('messages/:id')
  @HttpCode(204)
  async deleteMessage(@Req() req: Request, @Param('id') id: string): Promise<void> {
    await this.channels.deleteMessage(await this.actor(req), id);
  }

  @Get('realtime/socket')
  async socket(@Req() req: Request, @Res() res: Response): Promise<void> {
    const actor = await this.actor(req);
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    res.write(`event: ready\ndata: ${JSON.stringify({ userId: actor.userId })}\n\n`);
    const unsubscribe = this.hub.subscribe({
      actor,
      send: (event: RealtimeEvent) => {
        res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      },
    });
    const keepAlive = setInterval(() => res.write(': ping\n\n'), 25_000);
    req.on('close', () => {
      clearInterval(keepAlive);
      unsubscribe();
    });
  }
}
