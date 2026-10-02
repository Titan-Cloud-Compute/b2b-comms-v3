/**
 * Story: Unread Message Indicators — pure logic (no Nest / Prisma imports).
 */

export const UNREAD_CHANGED = 'unread.changed';

export interface UnreadActor {
  userId: string;
  role: string;
  organizationId: string | null;
  isExternal: boolean;
}

export interface ChannelLike { id: string; internal_only?: boolean | null }
export interface ReadStateLike { channel_id?: string | null; user_id?: string | null; unread_count?: number | null }
export interface RecipientLike { userId: string; isExternal: boolean }

/** External users never see internal-only channels. */
export function canSeeChannel(actor: { isExternal: boolean }, channel: { internal_only?: boolean | null }): boolean {
  return !(channel.internal_only === true && actor.isExternal);
}

/** Admins and Managers see every project; others need a project_members row. */
export function isPrivileged(role: string): boolean {
  const r = String(role ?? '').toUpperCase();
  return r === 'ADMIN' || r === 'SUPER_ADMIN' || r === 'MANAGER';
}

/**
 * Users whose unread_count must rise when `authorId` posts in `channel`:
 * every distinct candidate except the author, skipping users who cannot see the channel.
 */
export function unreadRecipients(candidates: RecipientLike[], authorId: string | null | undefined, channel: ChannelLike): string[] {
  const out = new Set<string>();
  for (const c of candidates) {
    if (!c.userId || c.userId === authorId) continue;
    if (!canSeeChannel(c, channel)) continue;
    out.add(c.userId);
  }
  return [...out];
}

/** Next unread_count after one new message. */
export function incrementUnread(current: number | null | undefined): number {
  const n = Number(current ?? 0);
  return (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0) + 1;
}

/** The row written when a user reads a channel. */
export function resetReadState(channelId: string, userId: string, lastMessageId: string | null) {
  return { channel_id: channelId, user_id: userId, last_read_message_id: lastMessageId, unread_count: 0 };
}

/** GET /api/projects/:id/unread body: one entry per visible channel, 0 when no row exists. */
export function shapeUnreadCounts(
  actor: { isExternal: boolean },
  channels: ChannelLike[],
  states: ReadStateLike[],
): { counts: { channel_id: string; unread_count: number }[] } {
  const byChannel = new Map<string, number>();
  for (const s of states) {
    if (s.channel_id) byChannel.set(s.channel_id, Math.max(0, Number(s.unread_count ?? 0) || 0));
  }
  return {
    counts: channels
      .filter((c) => canSeeChannel(actor, c))
      .map((c) => ({ channel_id: c.id, unread_count: byChannel.get(c.id) ?? 0 })),
  };
}

export type UnreadRequestMatch = { kind: 'post' | 'view'; channelId: string } | null;

/**
 * Recognises the General Channels requests that drive unread state:
 * POST /api/channels/:id/messages (post) and the first page of GET /api/channels/:id/messages (view).
 */
export function matchUnreadRequest(method: string, url: string): UnreadRequestMatch {
  const [path, query = ''] = String(url ?? '').split('?');
  const m = /^\/api\/channels\/([^/]+)\/messages\/?$/.exec(path);
  if (!m) return null;
  const channelId = decodeURIComponent(m[1]);
  const verb = String(method ?? '').toUpperCase();
  if (verb === 'POST') return { kind: 'post', channelId };
  if (verb === 'GET') {
    const hasCursor = new URLSearchParams(query).get('cursor');
    return hasCursor ? null : { kind: 'view', channelId };
  }
  return null;
}
