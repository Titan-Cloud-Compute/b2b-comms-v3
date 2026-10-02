import { MockApiClient } from '../../shared/api/api-client';

/* In-memory fixtures for USE_MOCKS mode. */
const channels = [
  { id: 'c-general', name: 'general', internal_only: false, unread_count: 2 },
  { id: 'c-design', name: 'design', internal_only: false, unread_count: 0 },
];
const unread = new Map<string, number>(channels.map((c) => [c.id, c.unread_count]));

function handlerFor(method: string, path: string): ((body?: unknown) => Promise<unknown>) | null {
  const [clean] = path.replace(/^\/api\//, '').split('?');
  const parts = clean.split('/');
  if (method === 'GET' && parts[0] === 'projects' && parts[2] === 'channels' && parts.length === 3) {
    return async () => ({ general: channels.map((c) => ({ ...c, unread_count: unread.get(c.id) ?? 0 })), questions: [] });
  }
  if (method === 'GET' && parts[0] === 'projects' && parts[2] === 'unread') {
    return async () => ({ counts: channels.map((c) => ({ channel_id: c.id, unread_count: unread.get(c.id) ?? 0 })) });
  }
  if (method === 'POST' && parts[0] === 'channels' && parts[2] === 'read') {
    return async () => {
      unread.set(parts[1], 0);
      return { channel_id: parts[1], last_read_message_id: null, unread_count: 0 };
    };
  }
  return null;
}

/** Register this feature's mock for `method path` if not already present. */
export function ensureUnreadMock(client: MockApiClient, method: string, path: string): void {
  const handler = handlerFor(method, path);
  if (handler) client.registerMock(method, path, handler);
}
