import { MockApiClient } from '../../shared/api/api-client';

/* In-memory fixtures for USE_MOCKS mode (endpoints: GET projects/:id/unread, POST channels/:id/read). */
const counts = new Map<string, number>([
  ['c-general', 3],
  ['c-design', 0],
]);

function handlerFor(method: string, path: string): ((body?: unknown) => Promise<unknown>) | null {
  const [clean] = path.replace(/^\/api\//, '').split('?');
  const parts = clean.split('/');
  if (method === 'GET' && parts[0] === 'projects' && parts[2] === 'unread' && parts.length === 3) {
    return async () => ({ counts: [...counts].map(([channel_id, unread_count]) => ({ channel_id, unread_count })) });
  }
  if (method === 'POST' && parts[0] === 'channels' && parts[2] === 'read' && parts.length === 3) {
    return async () => {
      counts.set(parts[1], 0);
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
