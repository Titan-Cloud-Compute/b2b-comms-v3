/**
 * Story: Unread Message Indicators — pure logic (no I/O).
 */

export interface UnreadCount {
  channel_id: string;
  unread_count: number;
}

export interface ReadStateLike {
  channel_id?: string | null;
  user_id?: string | null;
  unread_count?: number | null;
}

export interface UnreadChannelLike {
  internal_only?: boolean | null;
}

const MESSAGE_POST = /^\/api\/channels\/([^/?#]+)\/messages\/?$/;

/** Extracts the channel id from a `POST /api/channels/:id/messages` request, else null. */
export function messagePostTarget(req: { method?: string; originalUrl?: string; url?: string }): string | null {
  if (String(req?.method ?? '').toUpperCase() !== 'POST') return null;
  const path = String(req.originalUrl ?? req.url ?? '').split('?')[0];
  const m = MESSAGE_POST.exec(path);
  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * Who gets an unread increment for a new message: every candidate (project
 * member or user already tracking the channel) except the author, minus
 * External users when the channel is internal-only. Deduplicated.
 */
export function selectRecipients(
  candidateIds: ReadonlyArray<string | null | undefined>,
  authorId: string | null | undefined,
  channel: UnreadChannelLike,
  externalUserIds: ReadonlySet<string> = new Set(),
): string[] {
  const out = new Set<string>();
  for (const id of candidateIds) {
    if (!id || id === authorId) continue;
    if (channel.internal_only === true && externalUserIds.has(id)) continue;
    out.add(id);
  }
  return [...out];
}

/** Next stored unread_count after one new message (N -> N+1; null/invalid counts as 0). */
export function incrementUnread(current: number | null | undefined): number {
  const n = Number(current ?? 0);
  return (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0) + 1;
}

/** unread_count after the user reads the channel. */
export function resetUnread(): number {
  return 0;
}

/**
 * Shapes the GET /api/projects/:id/unread response: one entry per visible
 * channel, read from this user's channel_read_state rows only (others ignored).
 */
export function shapeCounts(
  visibleChannelIds: ReadonlyArray<string>,
  states: ReadonlyArray<ReadStateLike>,
  userId: string,
): { counts: UnreadCount[] } {
  const byChannel = new Map<string, number>();
  for (const s of states) {
    if (!s.channel_id || s.user_id !== userId) continue;
    const n = Number(s.unread_count ?? 0);
    byChannel.set(s.channel_id, Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);
  }
  return {
    counts: visibleChannelIds.map((channel_id) => ({ channel_id, unread_count: byChannel.get(channel_id) ?? 0 })),
  };
}
