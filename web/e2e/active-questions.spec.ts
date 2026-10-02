/**
 * Active Question Chats oracle. Runs under playwright.hermetic.config.ts
 * (static SPA, hash routing, every /api/** call mocked).
 */
import { test, expect, type Page } from '@playwright/test';

const PROJECT = 'p-1';
const QUESTION = 'q-1';

interface MockState {
  questions: Record<string, any>[];
  messages: Record<string, unknown>[];
  created: unknown[];
  posted: { bodyHtml: string }[];
}

async function mockApi(page: Page, side: 'internal' | 'external', resolvedSides: string[] = []): Promise<MockState> {
  const user = { id: 'u-1', email: 'u@example.com', name: 'U', role: 'USER', organizationId: 'org-int', active: true };
  const state: MockState = {
    questions: [
      { id: QUESTION, projectId: PROJECT, kind: 'question', name: 'Which revision?', status: 'open', resolvedSides, mySide: side, createdBy: 'u-2', createdAt: '2026-01-01T00:00:00Z' },
    ],
    messages: [
      { id: 'm-1', channelId: QUESTION, authorId: 'u-2', authorName: 'Ann', bodyHtml: '<b>Rev B</b> or C?', attachments: [], editedAt: null, deletedAt: null, createdAt: '2026-01-01T00:00:01Z' },
    ],
    created: [],
    posted: [],
  };
  let seq = 10;
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const method = req.method().toUpperCase();
    const apiPath = new URL(req.url()).pathname.replace(/^.*\/api\//, '');
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (method === 'GET' && (apiPath === 'users/me' || apiPath === 'auth/me')) return json(user);
    if (apiPath === `projects/${PROJECT}/channels` && method === 'GET') {
      return json([{ id: 'c-1', projectId: PROJECT, kind: 'general', name: 'general', internalOnly: false, status: 'open', createdAt: '2026-01-01T00:00:00Z' }]);
    }
    if (apiPath === `projects/${PROJECT}/questions`) {
      if (method === 'GET') return json(state.questions);
      if (method === 'POST') {
        const body = req.postDataJSON() as { title: string; bodyHtml: string };
        state.created.push(body);
        const q = { id: `q-${++seq}`, projectId: PROJECT, kind: 'question', name: body.title, status: 'open', resolvedSides: [], mySide: side, createdBy: user.id, createdAt: new Date().toISOString() };
        state.questions.push(q);
        state.messages.push({ id: `m-${++seq}`, channelId: q.id, authorId: user.id, authorName: user.name, bodyHtml: body.bodyHtml, attachments: [], editedAt: null, deletedAt: null, createdAt: new Date().toISOString() });
        return json(q, 201);
      }
    }
    const resolve = /^questions\/([^/]+)\/resolve$/.exec(apiPath);
    if (resolve) {
      const q = state.questions.find((x) => x['id'] === resolve[1])!;
      if (method === 'POST') {
        q['resolvedSides'] = [...new Set([...q['resolvedSides'], side])].sort();
        if (q['resolvedSides'].length === 2) q['status'] = 'resolved';
      } else if (method === 'DELETE') {
        q['resolvedSides'] = [];
      }
      return json(q);
    }
    const msgs = /^channels\/([^/]+)\/messages$/.exec(apiPath);
    if (msgs) {
      if (method === 'GET') return json(state.messages.filter((m) => m['channelId'] === msgs[1]));
      if (method === 'POST') {
        const q = state.questions.find((x) => x['id'] === msgs[1]);
        if (q?.['status'] === 'resolved') return json({ message: 'Forbidden' }, 403);
        const body = req.postDataJSON() as { bodyHtml: string };
        state.posted.push(body);
        if (q) q['resolvedSides'] = [];
        const created = { id: `m-${++seq}`, channelId: msgs[1], authorId: user.id, authorName: user.name, bodyHtml: body.bodyHtml, attachments: [], editedAt: null, deletedAt: null, createdAt: new Date().toISOString() };
        state.messages.push(created);
        return json(created, 201);
      }
    }
    if (method === 'GET') return json([]);
    return json({ ok: true });
  });
  return state;
}

const questionUrl = `/#/projects/${PROJECT}/questions/${QUESTION}`;

test.use({ serviceWorkers: 'block' });

test('question page shows Active Questions below General Channels with the thread', async ({ page }) => {
  await mockApi(page, 'internal');
  await page.goto(questionUrl);
  await expect(page.getByTestId('question-page')).toBeVisible({ timeout: 10_000 });
  expect(page.url()).not.toContain('/login');
  expect(page.url()).toContain('/questions/');
  await expect(page.getByTestId('general-channels-heading')).toHaveText('General Channels');
  await expect(page.getByTestId('active-questions-heading')).toHaveText('Active Questions');
  await expect(page.getByTestId('question-link')).toHaveText(['? Which revision?']);
  await expect(page.getByTestId('question-title')).toContainText('Which revision?');
  await expect(page.getByTestId('question-status')).toContainText('open');
  await expect(page.locator('[data-testid="message-body"] b')).toHaveText('Rev B');
});

test('a member opens a new question from the form', async ({ page }) => {
  const state = await mockApi(page, 'external');
  await page.goto(questionUrl);
  await expect(page.getByTestId('question-link')).toHaveCount(1, { timeout: 10_000 });
  await page.getByTestId('create-question').click();
  await expect(page.getByTestId('create-question-error')).toBeVisible();
  expect(state.created).toHaveLength(0);
  await page.getByTestId('new-question-title').fill('Delivery date?');
  await page.getByTestId('new-question-message').evaluate((el) => { el.innerHTML = '<i>When</i> do we ship?'; });
  await page.getByTestId('create-question').click();
  await expect(page.getByTestId('question-link')).toHaveText(['? Which revision?', '? Delivery date?']);
  await expect(page).toHaveURL(/\/questions\/q-\d+/);
  await expect(page.locator('[data-testid="message-body"] i')).toHaveText('When');
  expect(state.created).toEqual([{ title: 'Delivery date?', bodyHtml: '<i>When</i> do we ship?' }]);
});

test('first party resolves, sees the awaiting notice, and can withdraw', async ({ page }) => {
  await mockApi(page, 'internal');
  await page.goto(questionUrl);
  await page.getByTestId('resolve-question').click({ timeout: 10_000 });
  await expect(page.getByTestId('question-awaiting')).toContainText("awaiting the other party's resolution");
  await expect(page.getByTestId('question-status')).toContainText('open');
  await page.getByTestId('withdraw-resolution').click();
  await expect(page.getByTestId('question-awaiting')).toHaveCount(0);
  await expect(page.getByTestId('resolve-question')).toBeVisible();
});

test('second party resolving closes the question and hides the composer', async ({ page }) => {
  await mockApi(page, 'external', ['internal']);
  await page.goto(questionUrl);
  await expect(page.getByTestId('question-other-resolved')).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('resolve-question').click();
  await expect(page.getByTestId('question-status')).toContainText('resolved');
  await expect(page.getByTestId('question-resolved')).toBeVisible();
  await expect(page.getByTestId('composer')).toHaveCount(0);
  await expect(page.getByTestId('question-link-resolved')).toHaveCount(1);
});

test('a new message clears a resolution mark', async ({ page }) => {
  const state = await mockApi(page, 'internal', ['internal']);
  await page.goto(questionUrl);
  await expect(page.getByTestId('question-awaiting')).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('composer').evaluate((el) => { el.innerHTML = '<b>actually</b> one more thing'; });
  await page.getByTestId('send-message').click();
  await expect(page.getByTestId('message')).toHaveCount(2);
  await expect(page.getByTestId('question-awaiting')).toHaveCount(0);
  expect(state.posted).toEqual([{ bodyHtml: '<b>actually</b> one more thing' }]);
});
