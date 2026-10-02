import { MockApiClient } from '../../shared/api/api-client';

/* In-memory fixtures for USE_MOCKS mode. */
const channels = [{ id: 'c-general', name: 'general', internal_only: false, unread_count: 0 }];
const messages: {
  id: string; channel_id: string; author: { id: string; display_name: string }; body_html: string;
  attachments: { file_id: string; name: string }[]; reference_id: null; edited_at: string | null; created_at: string;
  deleted?: boolean;
}[] = [];
let seq = 1;

function handlerFor(method: string, path: string): ((body?: unknown) => Promise<unknown>) | null {
  const [clean] = path.replace(/^\/api\//, '').split('?');
  const parts = clean.split('/');
  if (parts[0] === 'projects' && parts[2] === 'channels') {
    if (method === 'GET') return async () => ({ general: channels, questions: [] });
    if (method === 'POST') {
      return async (body) => {
        const b = (body ?? {}) as { name?: string; internal_only?: boolean };
        const c = { id: `c${seq++}`, name: b.name ?? 'channel', internal_only: !!b.internal_only, unread_count: 0 };
        channels.push(c);
        return { ...c, kind: 'general', status: 'active' };
      };
    }
  }
  if (parts[0] === 'channels' && parts[2] === 'messages') {
    if (method === 'GET') {
      return async () => ({ items: messages.filter((m) => m.channel_id === parts[1] && !m.deleted).reverse(), next_cursor: null });
    }
    if (method === 'POST') {
      return async (body) => {
        const b = (body ?? {}) as { body_html?: string; file_ids?: string[] };
        const m = {
          id: `m${seq++}`, channel_id: parts[1], author: { id: 'u-me', display_name: 'You' },
          body_html: (b.body_html ?? '').replace(/<script[\s\S]*?<\/script>/gi, ''),
          attachments: (b.file_ids ?? []).map((f) => ({ file_id: f, name: f })), reference_id: null,
          edited_at: null, created_at: new Date().toISOString(),
        };
        messages.push(m);
        return { id: m.id, channel_id: m.channel_id, author_id: 'u-me', body_html: m.body_html, created_at: m.created_at };
      };
    }
  }
  if (parts[0] === 'messages' && parts.length === 2) {
    const row = () => messages.find((m) => m.id === parts[1]);
    if (method === 'PATCH') {
      return async (body) => {
        const m = row();
        if (m) Object.assign(m, { body_html: (body as { body_html?: string })?.body_html ?? '', edited_at: new Date().toISOString() });
        return m;
      };
    }
    if (method === 'DELETE') {
      return async () => {
        const m = row();
        if (m) m.deleted = true;
        return null;
      };
    }
  }
  return null;
}

/** Register this feature's mock for `method path` if not already present. */
export function ensureGeneralChannelsMock(client: MockApiClient, method: string, path: string): void {
  const handler = handlerFor(method, path);
  if (handler) client.registerMock(method, path, handler);
}
