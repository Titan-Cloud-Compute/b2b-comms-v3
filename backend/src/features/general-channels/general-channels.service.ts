import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
// Value imports (NOT `import type`) so Nest can inject them.
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeHubService } from './realtime-hub.service';
import {
  type GcActor,
  canCreateChannel,
  canModifyMessage,
  canViewChannel,
  isBlankMessage,
  sanitizeHtml,
} from './general-channels.logic';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Tx = any;

export const DEFAULT_CHANNEL_NAME = 'general';
const PAGE_SIZE = 50;

export interface CreateChannelInput { name: string; internal_only?: boolean }
export interface CreateMessageInput { body_html?: string; file_ids?: string[]; reference_id?: string | null }

@Injectable()
export class GeneralChannelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hub: RealtimeHubService,
  ) {}

  private run<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return (this.prisma as any).runAsAdmin(fn);
  }

  async resolveActor(session: { userId?: string; role?: string } | undefined): Promise<GcActor> {
    if (!session?.userId) throw new UnauthorizedException('not authenticated');
    return this.run(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: session.userId } });
      const organizationId = user?.organizationId ?? null;
      let isExternal = false;
      if (organizationId) {
        const org = await tx.organizations.findUnique({ where: { id: organizationId } });
        isExternal = !!org && org.is_internal === false;
      }
      return { userId: session.userId!, role: String(session.role ?? user?.role ?? ''), organizationId, isExternal };
    });
  }

  /** 404 when the project is missing, 403 when the actor may not see it. */
  private async assertProjectAccess(tx: Tx, actor: GcActor, projectId: string) {
    const project = await tx.projects.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Project does not exist');
    if (actor.isExternal && project.organization_id !== actor.organizationId) {
      throw new ForbiddenException('Forbidden');
    }
    if (!canCreateChannel(actor)) {
      const member = await tx.project_members.findFirst({ where: { project_id: projectId, user_id: actor.userId } });
      if (!member) throw new ForbiddenException('Forbidden');
    }
    return project;
  }

  private async loadChannel(tx: Tx, actor: GcActor, channelId: string) {
    const channel = await tx.channels.findUnique({ where: { id: channelId } });
    if (!channel || !channel.project_id) throw new NotFoundException('Channel does not exist');
    await this.assertProjectAccess(tx, actor, channel.project_id);
    if (!canViewChannel(actor, channel)) throw new ForbiddenException('Forbidden');
    return channel;
  }

  /** Every project has a default channel named "general". */
  private async ensureDefaultChannel(tx: Tx, projectId: string) {
    const generals = await tx.channels.findMany({ where: { project_id: projectId, kind: 'general' } });
    if (generals.some((c: any) => c.name === DEFAULT_CHANNEL_NAME)) return;
    const legacy = generals.find((c: any) => typeof c.name === 'string' && c.name.toLowerCase() === DEFAULT_CHANNEL_NAME);
    if (legacy) {
      await tx.channels.update({ where: { id: legacy.id }, data: { name: DEFAULT_CHANNEL_NAME } });
      return;
    }
    if (generals.length === 0) {
      await tx.channels.create({
        data: {
          project_id: projectId,
          kind: 'general',
          name: DEFAULT_CHANNEL_NAME,
          internal_only: false,
          status: 'active',
          created_at: new Date(),
        },
      });
    }
  }

  async listChannels(actor: GcActor, projectId: string) {
    return this.run(async (tx) => {
      await this.assertProjectAccess(tx, actor, projectId);
      await this.ensureDefaultChannel(tx, projectId);
      const rows = (await tx.channels.findMany({ where: { project_id: projectId } })) as any[];
      const visible = rows
        .filter((c) => canViewChannel(actor, c))
        .sort((a, b) => time(a.created_at ?? a.createdAt) - time(b.created_at ?? b.createdAt));
      const unread = new Map<string, number>();
      if (visible.length) {
        const states = (await tx.channel_read_state.findMany({
          where: { user_id: actor.userId, channel_id: { in: visible.map((c) => c.id) } },
        })) as any[];
        for (const s of states) unread.set(s.channel_id, Number(s.unread_count ?? 0));
      }
      const general = visible
        .filter((c) => (c.kind ?? 'general') === 'general')
        .map((c) => ({ id: c.id, name: c.name ?? '', internal_only: c.internal_only === true, unread_count: unread.get(c.id) ?? 0 }));
      const questions = visible
        .filter((c) => c.kind === 'question')
        .map((c) => ({ id: c.id, name: c.name ?? '', status: c.status ?? 'active', unread_count: unread.get(c.id) ?? 0 }));
      return { general, questions };
    });
  }

  async createChannel(actor: GcActor, projectId: string, input: CreateChannelInput) {
    if (!canCreateChannel(actor)) throw new ForbiddenException('Only Managers and Admins can create channels');
    return this.run(async (tx) => {
      await this.assertProjectAccess(tx, actor, projectId);
      const row = await tx.channels.create({
        data: {
          project_id: projectId,
          kind: 'general',
          name: input.name,
          internal_only: input.internal_only === true,
          status: 'active',
          created_by: actor.userId,
          created_at: new Date(),
        },
      });
      return { id: row.id, name: row.name, kind: row.kind, internal_only: row.internal_only === true, status: row.status };
    });
  }

  private async toItems(tx: Tx, rows: any[]) {
    const authorIds = [...new Set(rows.map((r) => r.author_id).filter(Boolean))];
    const users = authorIds.length ? ((await tx.user.findMany({ where: { id: { in: authorIds } } })) as any[]) : [];
    const ids = rows.map((r) => r.id);
    const atts = ids.length ? ((await tx.message_attachments.findMany({ where: { message_id: { in: ids } } })) as any[]) : [];
    const fileIds = [...new Set(atts.map((a) => a.file_id).filter(Boolean))];
    const files = fileIds.length ? ((await tx.files.findMany({ where: { id: { in: fileIds } } })) as any[]) : [];
    const refs = ids.length ? ((await tx.references.findMany({ where: { message_id: { in: ids } } })) as any[]) : [];
    return rows.map((r) => {
      const u = users.find((x) => x.id === r.author_id);
      return {
        id: r.id,
        channel_id: r.channel_id,
        author: { id: r.author_id, display_name: u?.name || u?.email || 'Unknown' },
        body_html: r.body_html ?? '',
        attachments: atts
          .filter((a) => a.message_id === r.id)
          .map((a) => ({ file_id: a.file_id, name: files.find((f) => f.id === a.file_id)?.name ?? 'attachment' })),
        reference_id: refs.find((x) => x.message_id === r.id)?.id ?? null,
        edited_at: iso(r.edited_at),
        created_at: iso(r.created_at ?? r.createdAt),
      };
    });
  }

  /** Newest-first page; `cursor` is the created_at of the oldest item already seen. */
  async listMessages(actor: GcActor, channelId: string, cursor?: string, limit = PAGE_SIZE) {
    return this.run(async (tx) => {
      await this.loadChannel(tx, actor, channelId);
      const take = Math.min(Math.max(Number(limit) || PAGE_SIZE, 1), 100);
      const where: any = { channel_id: channelId, deleted_at: null };
      if (cursor) {
        const d = new Date(cursor);
        if (Number.isNaN(d.getTime())) throw new BadRequestException('cursor: invalid');
        where.created_at = { lt: d };
      }
      const rows = (await tx.messages.findMany({
        where,
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        take: take + 1,
      })) as any[];
      const page = rows.slice(0, take);
      const items = await this.toItems(tx, page);
      const next_cursor = rows.length > take ? iso(page[page.length - 1].created_at) : null;
      return { items, next_cursor };
    });
  }

  async createMessage(actor: GcActor, channelId: string, input: CreateMessageInput) {
    const fileIds = (input.file_ids ?? []).filter((f) => typeof f === 'string' && f.trim() !== '');
    if (isBlankMessage(input.body_html, fileIds, input.reference_id)) {
      throw new BadRequestException('message must have text, an attachment or a reference');
    }
    const body_html = sanitizeHtml(input.body_html ?? '');
    const { row, item } = await this.run(async (tx) => {
      await this.loadChannel(tx, actor, channelId);
      const row = await tx.messages.create({
        data: { channel_id: channelId, author_id: actor.userId, body_html, created_at: new Date() },
      });
      for (const file_id of fileIds) {
        await tx.message_attachments.create({ data: { message_id: row.id, file_id } });
      }
      const [item] = await this.toItems(tx, [row]);
      return { row, item };
    });
    this.hub.publish({ type: 'message.created', channel_id: channelId, payload: item });
    return { id: row.id, channel_id: channelId, author_id: actor.userId, body_html, created_at: iso(row.created_at) };
  }

  private async loadOwnMessage(tx: Tx, actor: GcActor, messageId: string) {
    const msg = await tx.messages.findUnique({ where: { id: messageId } });
    if (!msg || msg.deleted_at) throw new NotFoundException('Message does not exist');
    await this.loadChannel(tx, actor, msg.channel_id);
    if (!canModifyMessage(actor, msg)) throw new ForbiddenException('Only the author can change this message');
    return msg;
  }

  async editMessage(actor: GcActor, messageId: string, bodyHtml: unknown) {
    const result = await this.run(async (tx) => {
      const msg = await this.loadOwnMessage(tx, actor, messageId);
      const atts = await tx.message_attachments.findMany({ where: { message_id: messageId } });
      if (isBlankMessage(bodyHtml, atts.map((a: any) => a.file_id))) {
        throw new BadRequestException('message must not be blank');
      }
      const body_html = sanitizeHtml(bodyHtml);
      const row = await tx.messages.update({ where: { id: messageId }, data: { body_html, edited_at: new Date() } });
      return { channelId: msg.channel_id as string, out: { id: row.id, body_html, edited_at: iso(row.edited_at) } };
    });
    this.hub.publish({ type: 'message.updated', channel_id: result.channelId, payload: result.out });
    return result.out;
  }

  async deleteMessage(actor: GcActor, messageId: string) {
    const channelId = await this.run(async (tx) => {
      const msg = await this.loadOwnMessage(tx, actor, messageId);
      await tx.messages.update({ where: { id: messageId }, data: { deleted_at: new Date() } });
      return msg.channel_id as string;
    });
    this.hub.publish({ type: 'message.deleted', channel_id: channelId, payload: { id: messageId } });
  }

  /** Validates access, then returns an unsubscribe function. */
  async subscribe(actor: GcActor, channelId: string, listener: Parameters<RealtimeHubService['subscribe']>[1]) {
    await this.run((tx) => this.loadChannel(tx, actor, channelId));
    return this.hub.subscribe(channelId, listener);
  }
}

function time(d: unknown): number {
  const t = d ? new Date(d as string).getTime() : 0;
  return Number.isNaN(t) ? 0 : t;
}

function iso(d: unknown): string | null {
  if (!d) return null;
  const date = d instanceof Date ? d : new Date(d as string);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
