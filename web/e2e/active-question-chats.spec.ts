/**
 * Hermetic spec for the Active Question Chats story.
 * Every /api/** call is mocked via page.route() — nothing reaches the network.
 */
import { test, expect, type Page } from '@playwright/test';

const PROJECT_ID = 'p1';
const QUESTION_ID = 'q1';

interface Q { id: string; name: string; status: string; sides: string[] }
interface State { questions: Q[]; messages: { id: string; channel_id: string; body_html: string }[]; seq: number; side: string }

async function mockApi(page: Page): Promise<State> {
  const state: State = {
    questions: [{ id: QUESTION_ID, name: 'Which drawing revision?', status: 'open', sides: [] }],
    messages: [{ id: 'm1', channel_id: QUESTION_ID, body_html: 'Rev B or Rev C?' }],
    seq: 10,
    side: 'internal',
  };
  const view = (q: Q) => ({ id: q.id, status: q.status, resolved_sides: [...q.sides].sort().join(',') });

  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const method = req.method().toUpperCase();
    const apiPath = new URL(req.url()).pathname.replace(/^.*\/api\//, '').replace(/^\//, '');
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (method === 'GET' && apiPath === 'users/me') return json({ id: 'u-me', email: 'manager@example.com', role: 'MANAGER' });

    if (apiPath === `projects/${PROJECT_ID}/questions`) {
      if (method === 'GET') {
        return json({ items: state.questions.map((q) => ({ ...view(q), name: q.name, unread_count: 0 })) });
      }
      if (method === 'POST') {
        const b = (await req.postDataJSON()) as { title?: string; body_html?: string };
        if (!b.title?.trim() || !b.body_html?.trim()) return json({ message: 'title: must not be blank' }, 400);
        const q: Q = { id: `q${state.seq++}`, name: b.title, status: 'open', sides: [] };
        state.questions.push(q);
        state.messages.push({ id: `m${state.seq++}`, channel_id: q.id, body_html: b.body_html });
        return json({ id: q.id, name: q.name, kind: 'question', status: 'open', first_message_id: 'mx' }, 201);
      }
    }

    const resolve = /^questions\/([^/]+)\/resolve$/.exec(apiPath);
    if (resolve) {
      const q = state.questions.find((x) => x.id === resolve[1])!;
      if (method === 'POST' && !q.sides.includes(state.side)) q.sides.push(state.side);
      if (method === 'DELETE') q.sides = [];
      if (q.sides.length === 2) q.status = 'resolved';
      return json(view(q));
    }

    const msgs = /^channels\/([^/]+)\/messages$/.exec(apiPath);
    if (msgs) {
      const cid = msgs[1];
      if (method === 'GET') {
        const items = state.messages.filter((m) => m.channel_id === cid).map((m) => ({
          ...m, author: { id: 'u-x', display_name: 'X' }, attachments: [], reference_id: null, edited_at: null,
          created_at: '2026-01-01T10:00:00.000Z',
        }));
        return json({ items: items.reverse(), next_cursor: null });
      }
      const q = state.questions.find((x) => x.id === cid);
      if (q?.status === 'resolved') return json({ message: 'Question is resolved' }, 403);
      const b = (await req.postDataJSON()) as { body_html?: string };
      const id = `m${state.seq++}`;
      state.messages.push({ id, channel_id: cid, body_html: b.body_html ?? '' });
      if (q) q.sides = [];
      return json({ id, channel_id: cid, author_id: 'u-me', body_html: b.body_html ?? '', created_at: new Date().toISOString() }, 201);
    }

    if (method === 'GET') return json([]);
    return json({ ok: true });
  });
  return state;
}

test.use({ serviceWorkers: 'block' });

async function gotoQuestion(page: Page, id = QUESTION_ID): Promise<void> {
  await page.goto(`/#/projects/${PROJECT_ID}/questions/${id}`);
  await expect(page.getByTestId('active-question-page')).toBeVisible({ timeout: 10_000 });
}

test('lists the open question under Active Questions with its thread', async ({ page }) => {
  await mockApi(page);
  await gotoQuestion(page);
  await expect(page.getByTestId('active-questions-list')).toContainText('Which drawing revision?');
  await expect(page.getByTestId('question-status')).toHaveText('open');
  await expect(page.getByTestId('message-body').first()).toContainText('Rev B or Rev C?');
});

test('first mark shows awaiting, second mark resolves and closes the composer', async ({ page }) => {
  const state = await mockApi(page);
  await gotoQuestion(page);

  await page.getByTestId('question-resolve').click();
  await expect(page.getByTestId('question-status')).toHaveText("awaiting the other party's resolution");
  await expect(page.getByTestId('question-withdraw')).toBeVisible();

  state.side = 'external';
  await page.getByTestId('question-resolve').click();
  await expect(page.getByTestId('question-status')).toHaveText('resolved');
  await expect(page.getByTestId('message-composer')).toHaveCount(0);
  await expect(page.getByTestId('question-closed')).toBeVisible();
});

test('withdrawing a mark returns the question to open', async ({ page }) => {
  await mockApi(page);
  await gotoQuestion(page);
  await page.getByTestId('question-resolve').click();
  await expect(page.getByTestId('question-status')).toHaveText("awaiting the other party's resolution");
  await page.getByTestId('question-withdraw').click();
  await expect(page.getByTestId('question-status')).toHaveText('open');
});

test('creating a question navigates to it and lists it', async ({ page }) => {
  await mockApi(page);
  await gotoQuestion(page);
  await expect(page.getByTestId('create-question-submit')).toBeDisabled();
  await page.getByTestId('create-question-title').fill('Is the slab load final?');
  await page.getByTestId('create-question-body').fill('Please confirm.');
  await page.getByTestId('create-question-submit').click();
  await expect(page).toHaveURL(/questions\/q10$/);
  await expect(page.getByTestId('active-questions-list')).toContainText('Is the slab load final?');
  await expect(page.getByTestId('question-title')).toHaveText('Is the slab load final?');
});
