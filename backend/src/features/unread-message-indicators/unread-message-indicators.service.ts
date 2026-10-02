import { Injectable } from '@nestjs/common';
// Value imports (NOT `import type`) so Nest can inject them.
import { PrismaService } from '../../prisma/prisma.service';
import { GeneralChannelsService } from '../general-channels/general-channels.service';
import type { GcActor } from '../general-channels/general-channels.logic';
import { UnreadHubService } from './unread-hub.service';
import { incrementUnread, resetUnread, selectRecipients, shapeCounts } from './unread-message-indicators.logic';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Tx = any;

@Injectable()
export class UnreadMessageIndicatorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly channels: GeneralChannelsService,
    private readonly hub: UnreadHubService,
  ) {}

  private run<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return (this.prisma as any).runAsAdmin(fn);
  }

  /** 401 when there is no session. */
  resolveActor(session: { userId?: string; role?: string } | undefined): Promise<GcActor> {
    return this.channels.resolveActor(session);
  }

  /** Counts for every channel the actor may see (404/403 via the channel access rules). */
  async counts(actor: GcActor, projectId: string) {
    const list = await this.channels.listChannels(actor, projectId);
    const ids = [...list.general, ...list.questions].map((c) => c.id);
    if (!ids.length) return { counts: [] };
    const states = await this.run(
      (tx) => tx.channel_read_state.findMany({ where: { user_id: actor.userId, channel_id: { in: ids } } }) as Promise<any[]>,
    );
    return shapeCounts(ids, states, actor.userId);
  }

  /** Marks the channel read for the actor (403 when the channel is not visible). */
  async markRead(actor: GcActor, channelId: string) {
    const page = await this.channels.listMessages(actor, channelId, undefined, 1);
    const last = page.items[0]?.id ?? null;
    const { projectId } = await this.run(async (tx) => {
      const channel = await tx.channels.findUnique({ where: { id: channelId } });
      await this.writeState(tx, channelId, actor.userId, { last_read_message_id: last, unread_count: resetUnread() });
      return { projectId: (channel?.project_id as string | null) ?? null };
    });
    this.hub.publish(actor.userId, {
      type: 'unread.changed',
      channel_id: channelId,
      payload: { project_id: projectId, unread_count: 0 },
    });
    return { channel_id: channelId, last_read_message_id: last, unread_count: 0 };
  }

  /** Write-path hook: a new message increments every other recipient's unread_count. */
  async onMessagePosted(channelId: string, authorId: string): Promise<void> {
    const changes = await this.run(async (tx) => {
      const channel = await tx.channels.findUnique({ where: { id: channelId } });
      if (!channel?.project_id) return [] as { userId: string; count: number; projectId: string }[];
      const members = (await tx.project_members.findMany({ where: { project_id: channel.project_id } })) as any[];
      const states = (await tx.channel_read_state.findMany({ where: { channel_id: channelId } })) as any[];
      const candidates = [...members.map((m) => m.user_id), ...states.map((s) => s.user_id)];
      const external = new Set<string>();
      if (channel.internal_only === true) {
        const ids = [...new Set(candidates.filter(Boolean))];
        const users = ids.length ? ((await tx.user.findMany({ where: { id: { in: ids } } })) as any[]) : [];
        const orgIds = [...new Set(users.map((u) => u.organizationId).filter(Boolean))];
        const orgs = orgIds.length ? ((await tx.organizations.findMany({ where: { id: { in: orgIds } } })) as any[]) : [];
        for (const u of users) {
          const org = orgs.find((o) => o.id === u.organizationId);
          if (org && org.is_internal === false) external.add(u.id);
        }
      }
      const out: { userId: string; count: number; projectId: string }[] = [];
      for (const userId of selectRecipients(candidates, authorId, channel, external)) {
        const current = states.find((s) => s.user_id === userId);
        const count = incrementUnread(current?.unread_count);
        await this.writeState(tx, channelId, userId, { unread_count: count }, current);
        out.push({ userId, count, projectId: channel.project_id });
      }
      return out;
    });
    for (const c of changes) {
      this.hub.publish(c.userId, {
        type: 'unread.changed',
        channel_id: channelId,
        payload: { project_id: c.projectId, unread_count: c.count },
      });
    }
  }

  subscribe(actor: GcActor, listener: Parameters<UnreadHubService['subscribe']>[1]): () => void {
    return this.hub.subscribe(actor.userId, listener);
  }

  private async writeState(tx: Tx, channelId: string, userId: string, data: Record<string, unknown>, existing?: any) {
    const row = existing ?? (await tx.channel_read_state.findFirst({ where: { channel_id: channelId, user_id: userId } }));
    if (row) return tx.channel_read_state.update({ where: { id: row.id }, data });
    return tx.channel_read_state.create({ data: { channel_id: channelId, user_id: userId, unread_count: 0, ...data } });
  }
}
