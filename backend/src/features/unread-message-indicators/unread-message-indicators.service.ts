import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
// Value imports (NOT `import type`) so Nest can inject them.
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeHubService } from '../general-channels/realtime-hub.service';
import {
  UNREAD_CHANGED,
  type RecipientLike,
  type UnreadActor,
  canSeeChannel,
  incrementUnread,
  isPrivileged,
  resetReadState,
  shapeUnreadCounts,
  unreadRecipients,
} from './unread-message-indicators.logic';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Tx = any;

@Injectable()
export class UnreadMessageIndicatorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hub: RealtimeHubService,
  ) {}

  private run<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return (this.prisma as any).runAsAdmin(fn);
  }

  /** 404 when the project is missing, 403 when the actor may not see it. */
  private async assertProjectAccess(tx: Tx, actor: UnreadActor, projectId: string) {
    const project = await tx.projects.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Project does not exist');
    if (actor.isExternal && project.organization_id !== actor.organizationId) throw new ForbiddenException('Forbidden');
    if (!isPrivileged(actor.role)) {
      const member = await tx.project_members.findFirst({ where: { project_id: projectId, user_id: actor.userId } });
      if (!member) throw new ForbiddenException('Forbidden');
    }
    return project;
  }

  private async loadChannel(tx: Tx, actor: UnreadActor, channelId: string) {
    const channel = await tx.channels.findUnique({ where: { id: channelId } });
    if (!channel || !channel.project_id) throw new NotFoundException('Channel does not exist');
    await this.assertProjectAccess(tx, actor, channel.project_id);
    if (!canSeeChannel(actor, channel)) throw new ForbiddenException('Forbidden');
    return channel;
  }

  /** GET /api/projects/:id/unread */
  async listUnread(actor: UnreadActor, projectId: string) {
    return this.run(async (tx) => {
      await this.assertProjectAccess(tx, actor, projectId);
      const channels = ((await tx.channels.findMany({ where: { project_id: projectId } })) as any[]).filter((c) =>
        canSeeChannel(actor, c),
      );
      const states = channels.length
        ? ((await tx.channel_read_state.findMany({
            where: { user_id: actor.userId, channel_id: { in: channels.map((c) => c.id) } },
          })) as any[])
        : [];
      return shapeUnreadCounts(actor, channels, states);
    });
  }

  /** POST /api/channels/:id/read — access-checked. */
  async markRead(actor: UnreadActor, channelId: string) {
    await this.run((tx) => this.loadChannel(tx, actor, channelId));
    return this.resetFor(channelId, actor.userId);
  }

  /** Zeroes the user's own row (no access check: callers have already authorised the channel). */
  async resetFor(channelId: string, userId: string) {
    const out = await this.run(async (tx) => {
      const [latest] = (await tx.messages.findMany({
        where: { channel_id: channelId, deleted_at: null },
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        take: 1,
      })) as any[];
      const data = resetReadState(channelId, userId, latest?.id ?? null);
      const existing = await tx.channel_read_state.findFirst({ where: { channel_id: channelId, user_id: userId } });
      if (existing) {
        await tx.channel_read_state.update({
          where: { id: existing.id },
          data: { last_read_message_id: data.last_read_message_id, unread_count: 0 },
        });
      } else {
        await tx.channel_read_state.create({ data });
      }
      return data;
    });
    this.hub.publish({ type: UNREAD_CHANGED, channel_id: channelId, payload: { user_id: userId, unread_count: 0 } });
    return { channel_id: out.channel_id, last_read_message_id: out.last_read_message_id, unread_count: 0 };
  }

  /** A message was posted: unread_count += 1 for every other member who can see the channel. */
  async onMessagePosted(channelId: string, authorId: string) {
    const changed = await this.run(async (tx) => {
      const channel = await tx.channels.findUnique({ where: { id: channelId } });
      if (!channel?.project_id) return [] as { userId: string; count: number }[];
      const project = await tx.projects.findUnique({ where: { id: channel.project_id } });
      const members = (await tx.project_members.findMany({ where: { project_id: channel.project_id } })) as any[];
      const states = (await tx.channel_read_state.findMany({ where: { channel_id: channelId } })) as any[];
      const ids = [...new Set([...members.map((m) => m.user_id), ...states.map((s) => s.user_id)].filter(Boolean))] as string[];
      if (!ids.length) return [];
      const users = (await tx.user.findMany({ where: { id: { in: ids } } })) as any[];
      const orgIds = [...new Set(users.map((u) => u.organizationId).filter(Boolean))];
      const orgs = orgIds.length ? ((await tx.organizations.findMany({ where: { id: { in: orgIds } } })) as any[]) : [];
      const candidates: RecipientLike[] = [];
      for (const u of users) {
        if (u.active === false) continue;
        const org = orgs.find((o) => o.id === u.organizationId);
        const isExternal = !!org && org.is_internal === false;
        if (isExternal && project && project.organization_id !== u.organizationId) continue;
        candidates.push({ userId: u.id, isExternal });
      }
      const result: { userId: string; count: number }[] = [];
      for (const userId of unreadRecipients(candidates, authorId, channel)) {
        const row = states.find((s) => s.user_id === userId);
        const count = incrementUnread(row?.unread_count);
        if (row) await tx.channel_read_state.update({ where: { id: row.id }, data: { unread_count: count } });
        else await tx.channel_read_state.create({ data: { channel_id: channelId, user_id: userId, last_read_message_id: null, unread_count: count } });
        result.push({ userId, count });
      }
      return result;
    });
    for (const c of changed) {
      this.hub.publish({ type: UNREAD_CHANGED, channel_id: channelId, payload: { user_id: c.userId, unread_count: c.count } });
    }
    return changed;
  }
}
