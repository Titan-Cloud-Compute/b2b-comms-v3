import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { canCreateChannel } from './general-channels.logic';
import { GeneralChannelsService } from './general-channels.service';

const CreateChannelSchema = z.object({
  name: z.string().trim().min(1, 'must not be blank').max(80),
  internal_only: z.boolean().optional(),
});
const CreateMessageSchema = z.object({
  body_html: z.string().max(100_000).optional().default(''),
  file_ids: z.array(z.string()).max(20).optional().default([]),
  reference_id: z.string().nullable().optional(),
});
const EditMessageSchema = z.object({ body_html: z.string().max(100_000) });

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

export const HEARTBEAT_MS = 25_000;

@ApiTags('channels')
@Controller('api')
export class GeneralChannelsController {
  constructor(private readonly svc: GeneralChannelsService) {}

  private actor(req: Request) {
    return this.svc.resolveActor((req as SessionReq).session);
  }

  @Get('projects/:id/channels')
  async listChannels(@Req() req: Request, @Param('id') id: string) {
    return this.svc.listChannels(await this.actor(req), id);
  }

  @Post('projects/:id/channels')
  @HttpCode(HttpStatus.CREATED)
  async createChannel(@Req() req: Request, @Param('id') id: string, @Body() body: unknown) {
    const actor = await this.actor(req);
    // Role check before body validation: an Employee gets 403 even with a bad body.
    if (!canCreateChannel(actor)) throw new ForbiddenException('Only Managers and Admins can create channels');
    return this.svc.createChannel(actor, id, parse(CreateChannelSchema, body));
  }

  @Get('channels/:id/messages')
  async listMessages(
    @Req() req: Request,
    @Param('id') id: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.svc.listMessages(await this.actor(req), id, cursor || undefined, limit ? Number(limit) : undefined);
  }

  @Post('channels/:id/messages')
  @HttpCode(HttpStatus.CREATED)
  async createMessage(@Req() req: Request, @Param('id') id: string, @Body() body: unknown) {
    const actor = await this.actor(req);
    return this.svc.createMessage(actor, id, parse(CreateMessageSchema, body));
  }

  @Patch('messages/:id')
  async editMessage(@Req() req: Request, @Param('id') id: string, @Body() body: unknown) {
    const actor = await this.actor(req);
    return this.svc.editMessage(actor, id, parse(EditMessageSchema, body).body_html);
  }

  @Delete('messages/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteMessage(@Req() req: Request, @Param('id') id: string) {
    await this.svc.deleteMessage(await this.actor(req), id);
  }

  /**
   * Real-time stream (Server-Sent Events). Each event is a JSON object
   * `{ type, channel_id, payload }`, e.g. type "message.created".
   */
  @Get('realtime/socket')
  async socket(@Req() req: Request, @Res() res: Response, @Query('channel_id') channelId?: string) {
    const actor = await this.actor(req);
    if (!channelId) throw new BadRequestException('channel_id: required');
    const unsubscribe = await this.svc.subscribe(actor, channelId, (event) => {
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    });
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    res.write(`event: ready\ndata: ${JSON.stringify({ type: 'ready', channel_id: channelId, payload: {} })}\n\n`);
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
