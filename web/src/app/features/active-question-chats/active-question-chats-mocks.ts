import { MockApiClient } from '../../shared/api/api-client';

/* In-memory fixtures for USE_MOCKS mode. */
interface MockQuestion { id: string; project_id: string; name: string; status: string; sides: string[] }

const questions: MockQuestion[] = [
  { id: 'q1', project_id: 'p1', name: 'Which drawing revision?', status: 'open', sides: ['external'] },
];
let seq = 2;

function view(q: MockQuestion) {
  return { id: q.id, status: q.status, resolved_sides: [...q.sides].sort().join(',') };
}

function handlerFor(method: string, path: string): ((body?: unknown) => Promise<unknown>) | null {
  const [clean] = path.replace(/^\/api\//, '').split('?');
  const parts = clean.split('/');
  if (parts[0] === 'projects' && parts[2] === 'questions' && parts.length === 3) {
    const pid = parts[1];
    if (method === 'GET') {
      return async () => ({
        items: questions.filter((q) => q.project_id === pid).map((q) => ({ ...view(q), name: q.name, unread_count: 0 })),
      });
    }
    if (method === 'POST') {
      return async (body) => {
        const b = (body ?? {}) as { title?: string; body_html?: string };
        if (!b.title?.trim() || !b.body_html?.trim()) throw Object.assign(new Error('title and first message are required'), { status: 400 });
        const q: MockQuestion = { id: `q${seq++}`, project_id: pid, name: b.title.trim(), status: 'open', sides: [] };
        questions.push(q);
        return { id: q.id, name: q.name, kind: 'question', status: 'open', first_message_id: `m-${q.id}` };
      };
    }
  }
  if (parts[0] === 'questions' && parts[2] === 'resolve' && parts.length === 3) {
    const q = () => questions.find((x) => x.id === parts[1]);
    if (method === 'POST') {
      return async () => {
        const row = q();
        if (!row) throw Object.assign(new Error('Question does not exist'), { status: 404 });
        if (!row.sides.includes('internal')) row.sides.push('internal');
        if (row.sides.includes('internal') && row.sides.includes('external')) row.status = 'resolved';
        return view(row);
      };
    }
    if (method === 'DELETE') {
      return async () => {
        const row = q();
        if (!row) throw Object.assign(new Error('Question does not exist'), { status: 404 });
        if (row.status !== 'resolved') row.sides = [];
        return view(row);
      };
    }
  }
  return null;
}

/** Register this feature's mock for `method path` if not already present. */
export function ensureActiveQuestionChatsMock(client: MockApiClient, method: string, path: string): void {
  const handler = handlerFor(method, path);
  if (handler) client.registerMock(method, path, handler);
}
