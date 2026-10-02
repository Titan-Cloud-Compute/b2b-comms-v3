import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { Actor, ProjectFacts } from '../projects/projects.policy';
import {
  CHANNEL_KIND_GENERAL,
  CreateChannelInput,
  EditMessageInput,
  PostMessageInput,
  canCreateChannel,
  canModifyMessage,
  canViewChannel,
} from './general-channels.policy';
import { canViewProject } from '../projects/projects.policy';
import { isBlankMessageHtml, sanitizeMessageHtml } from './message-sanitizer';
import { RealtimeEvent, RealtimeHub } from './realtime.hub';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = any;

export interface ChannelDto {
  id: string;
  projectId: string;
  kind: string;
  name: string;
  internalOnly: boolean;
  status: string;
  createdAt: Date;
}

export interface MessageDto {
  id: string;
  channelId: string;
  authorId: string;
  authorName: string;
  bodyHtml: string;
  attachments: { id: string; fileId: string }[];
  editedAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
}

function channelDto(c: Row): ChannelDto {
  return {
    id: c.id,
    projectId: c.project_id,
    kind: c.kind,
    name: c.name,
    internalOnly: !!c.internal_only,
    status: c.status,
    createdAt: c.created_at,
  };
}

function messageDto(m: Row): MessageDto {
  const deleted = !!m.deleted_at;
  return {
    id: m.id,
    channelId: m.channel_id,
    authorId: m.author_id,
    authorName: m.author?.name ?? m.author?.display_name ?? m.author?.email ?? '',
    bodyHtml: deleted ? '' : m.body_html,
    attachments: deleted
      ? []
      : (m.attachments ?? []).map((a: Row) => ({ id: a.id, fileId: a.file_id })),
    editedAt: m.edited_at ?? null,
    deletedAt: m.deleted_at ?? null,
    createdAt: m.created_at,
  };
}

function projectFacts(p: Row): ProjectFacts {
  return {
    organizationId: p.organization_id,
    status: p.status,
    memberUserIds: (p.members ?? []).map((m: Row) => m.user_id),
  };
}

const MESSAGE_INCLUDE = { attachments: true, author: { select: { id: true, email: true, name: true } } };

@Injectable()
export class GeneralChannelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hub: RealtimeHub,
  ) {}

  private get db(): any {
    return this.prisma as any;
  }

  private async loadProject(projectId: string): Promise<{ row: Row; facts: ProjectFacts }> {
    const row = await this.db.projects.findUnique({
      where: { id: projectId },
      include: { members: { select: { user_id: true } } },
    });
    if (!row) throw new NotFoundException('project not found');
    return { row, facts: projectFacts(row) };
  }

  /** Load a channel the actor can see, or throw 404/403. */
  private async loadChannel(actor: Actor, channelId: string): Promise<{ channel: Row; facts: ProjectFacts }> {
    const channel = await this.db.channels.findUnique({
      where: { id: channelId },
      include: { project: { include: { members: { select: { user_id: true } } } } },
    });
    if (!channel) throw new NotFoundException('channel not found');
    const facts = projectFacts(channel.project);
    if (!canViewChannel(actor, facts, channel)) throw new ForbiddenException('you cannot access this channel');
    return { channel, facts };
  }

  private publish(type: RealtimeEvent['type'], channel: Row, facts: ProjectFacts, payload: unknown): void {
    this.hub.publish(
      { type, channelId: channel.id, projectId: channel.project_id, payload },
      (who) => canViewChannel(who, facts, channel),
    );
  }

  async listChannels(actor: Actor, projectId: string): Promise<ChannelDto[]> {
    const { facts } = await this.loadProject(projectId);
    if (!canViewProject(actor, facts)) throw new ForbiddenException('you cannot access this project');
    const where: Row = { project_id: projectId, kind: CHANNEL_KIND_GENERAL };
    if (actor.isExternal) where.internal_only = false;
    const rows = await this.db.channels.findMany({ where, orderBy: { created_at: 'asc' } });
    return rows.map(channelDto);
  }

  async createChannel(actor: Actor, projectId: string, input: CreateChannelInput): Promise<ChannelDto> {
    const { facts } = await this.loadProject(projectId);
    if (!canCreateChannel(actor, facts)) {
      throw new ForbiddenException('only managers and admins can create channels');
    }
    const row = await this.db.channels.create({
      data: {
        project_id: projectId,
        kind: CHANNEL_KIND_GENERAL,
        name: input.name,
        internal_only: input.internalOnly,
        status: 'open',
        created_by: actor.userId,
      },
    });
    const dto = channelDto(row);
    this.publish('channel.created', row, facts, dto);
    return dto;
  }

  async listMessages(actor: Actor, channelId: string): Promise<MessageDto[]> {
    await this.loadChannel(actor, channelId);
    const rows = await this.db.messages.findMany({
      where: { channel_id: channelId },
      include: MESSAGE_INCLUDE,
      orderBy: { created_at: 'asc' },
      take: 500,
    });
    return rows.map(messageDto);
  }

  async postMessage(actor: Actor, channelId: string, input: PostMessageInput): Promise<MessageDto> {
    const { channel, facts } = await this.loadChannel(actor, channelId);
    const bodyHtml = sanitizeMessageHtml(input.bodyHtml);
    const fileIds = [...new Set(input.attachmentFileIds)];
    if (isBlankMessageHtml(bodyHtml) && fileIds.length === 0 && !input.referenceId) {
      throw new BadRequestException('message must not be blank');
    }
    if (fileIds.length) {
      const files = await this.db.files.findMany({
        where: { id: { in: fileIds }, project_id: channel.project_id, deleted_at: null },
        select: { id: true },
      });
      if (files.length !== fileIds.length) throw new BadRequestException('attachment not found in this project');
    }
    const row = await this.db.messages.create({
      data: {
        channel_id: channelId,
        author_id: actor.userId,
        body_html: bodyHtml,
        ...(fileIds.length ? { attachments: { create: fileIds.map((file_id) => ({ file_id })) } } : {}),
      },
      include: MESSAGE_INCLUDE,
    });
    const dto = messageDto(row);
    this.publish('message.created', channel, facts, dto);
    return dto;
  }

  private async loadOwnMessage(actor: Actor, messageId: string) {
    const message = await this.db.messages.findUnique({ where: { id: messageId } });
    if (!message || message.deleted_at) throw new NotFoundException('message not found');
    const { channel, facts } = await this.loadChannel(actor, message.channel_id);
    if (!canModifyMessage(actor, message)) throw new ForbiddenException('only the author can change this message');
    return { message, channel, facts };
  }

  async editMessage(actor: Actor, messageId: string, input: EditMessageInput): Promise<MessageDto> {
    const { message, channel, facts } = await this.loadOwnMessage(actor, messageId);
    const bodyHtml = sanitizeMessageHtml(input.bodyHtml);
    const attachments = await this.db.message_attachments.count({ where: { message_id: message.id } });
    if (isBlankMessageHtml(bodyHtml) && attachments === 0) throw new BadRequestException('message must not be blank');
    const row = await this.db.messages.update({
      where: { id: messageId },
      data: { body_html: bodyHtml, edited_at: new Date() },
      include: MESSAGE_INCLUDE,
    });
    const dto = messageDto(row);
    this.publish('message.updated', channel, facts, dto);
    return dto;
  }

  async deleteMessage(actor: Actor, messageId: string): Promise<void> {
    const { channel, facts } = await this.loadOwnMessage(actor, messageId);
    const row = await this.db.messages.update({
      where: { id: messageId },
      data: { deleted_at: new Date() },
      include: MESSAGE_INCLUDE,
    });
    this.publish('message.deleted', channel, facts, messageDto(row));
  }
}
