/**
 * Active Questions oracle. Runs under playwright.hermetic.config.ts
 * (static SPA, hash routing, every /api/** call mocked — nothing reaches the network).
 */
import { test, expect, type Page } from '@playwright/test';

const PROJECT = 'p-1';
const Q_OPEN = 'q-1';
const Q_RESOLVED = 'q-resolved';

type Question = {
  id: string;
  projectId: string;
  title: string;
  status: 'open' | 'resolved';
  createdBy: string;
  createdAt: string;
  resolvedSides: string[];
  mySide: string;
};

type Message = {
  id: string;
  author_id: string;
  body_html: string;
  created_at: string;
};

interface MockState {
  questions: Question[];
  messages: Message[];
  posted: { body_html: string }[];
}

async function mockApi(page: Page): Promise<MockState> {
  const user = { id: 'u-1', email: 'u@example.com', name: 'U', role: 'MANAGER', organizationId: 'org-int', active: true };

  const state: MockState = {
    questions: [
      {
        id: Q_OPEN,
        projectId: PROJECT,
        title: 'First question',
        status: 'open',
        createdBy: 'u-1',
        createdAt: '2026-01-01T00:00:00Z',
        resolvedSides: [],
        mySide: 'internal',
      },
      {
        id: Q_RESOLVED,
        projectId: PROJECT,
        title: 'Resolved question',
        status: 'resolved',
        createdBy: 'u-1',
        createdAt: '2026-01-01T00:00:00Z',
        resolvedSides: ['internal', 'external'],
        mySide: 'internal',
      },
    ],
    messages: [
      { id: 'm-1', author_id: 'u-1', body_html: '<b>Hello</b>', created_at: '2026-01-01T00:00:01Z' },
    ],
    posted: [],
  };

  let seq = 100;

  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const method = req.method().toUpperCase();
    const apiPath = new URL(req.url()).pathname
      .replace(/^.*\/api\//, '').replace(/^api\//, '').replace(/^\//, '');
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    // Auth
    if (method === 'GET' && (apiPath === 'users/me' || apiPath === 'auth/me')) return json(user);
    if (method === 'POST' && apiPath === 'auth/login') return json(user);
    if (method === 'POST' && apiPath === 'auth/logout') return route.fulfill({ status: 204, body: '' });

    // SSE
    if (apiPath === 'realtime/socket') {
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body: 'retry: 600000\n\n' });
    }

    // List questions
    const listMatch = /^projects\/([^/]+)\/questions$/.exec(apiPath);
    if (listMatch) {
      if (method === 'GET') return json(state.questions.filter(q => q.projectId === listMatch[1]));
      if (method === 'POST') {
        const body = req.postDataJSON() as { title: string; body_html: string };
        const created: Question = {
          id: `q-${++seq}`,
          projectId: listMatch[1],
          title: body.title,
          status: 'open',
          createdBy: user.id,
          createdAt: new Date().toISOString(),
          resolvedSides: [],
          mySide: 'internal',
        };
        state.questions.push(created);
        return json(created, 201);
      }
    }

    // Resolve
    const resolveMatch = /^questions\/([^/]+)\/resolve$/.exec(apiPath);
    if (resolveMatch) {
      const q = state.questions.find(x => x.id === resolveMatch[1]);
      if (!q) return json({ message: 'Not found' }, 404);
      if (method === 'POST') {
        if (!q.resolvedSides.includes(q.mySide)) {
          q.resolvedSides = [...q.resolvedSides, q.mySide];
        }
        return json(q);
      }
      if (method === 'DELETE') {
        q.resolvedSides = q.resolvedSides.filter(s => s !== q.mySide);
        return json(q);
      }
    }

    // Messages for a channel
    const msgsMatch = /^channels\/([^/]+)\/messages$/.exec(apiPath);
    if (msgsMatch) {
      if (method === 'GET') {
        return json(state.messages.filter(m => true)); // all messages in this mock
      }
      if (method === 'POST') {
        const body = req.postDataJSON() as { body_html: string };
        state.posted.push(body);
        const msg: Message = {
          id: `m-${++seq}`,
          author_id: user.id,
          body_html: body.body_html,
          created_at: new Date().toISOString(),
        };
        state.messages.push(msg);
        return json(msg, 201);
      }
    }

    if (method === 'GET') return json([]);
    return json({ ok: true });
  });

  return state;
}

async function signIn(page: Page): Promise<void> {
  await page.goto('/#/login');
  await page.locator('#email').fill('u@example.com');
  await page.locator('#password').fill('password1234');
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/#\/dashboard/, { timeout: 10_000 });
}

test.use({ serviceWorkers: 'block' });

test('(a) shows Active Questions heading and the seeded question item', async ({ page }) => {
  await mockApi(page);
  await signIn(page);
  await page.goto(`/#/projects/${PROJECT}/questions/${Q_OPEN}`);
  await expect(page.getByTestId('active-questions-heading')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('active-questions-heading')).toHaveText('Active Questions');
  await expect(page.getByTestId('question-item')).toHaveCount(2);
  await expect(page.getByTestId('question-item').first()).toHaveText('First question');
});

test('(b) creating a question with title and body adds it to the list and navigates to it', async ({ page }) => {
  await mockApi(page);
  await signIn(page);
  await page.goto(`/#/projects/${PROJECT}/questions/${Q_OPEN}`);
  await expect(page.getByTestId('active-questions-heading')).toBeVisible({ timeout: 10_000 });

  await page.getByTestId('new-question-title').fill('New question title');
  await page.getByTestId('new-question-body').fill('First message body');
  await page.getByTestId('new-question-submit').click();

  // Should navigate to the new question URL
  await expect(page).toHaveURL(/\/questions\/q-\d+/, { timeout: 10_000 });
  // List should have 3 items now
  await expect(page.getByTestId('question-item')).toHaveCount(3);
});

test('(c) a blank-title submit sends no POST', async ({ page }) => {
  const state = await mockApi(page);
  await signIn(page);
  await page.goto(`/#/projects/${PROJECT}/questions/${Q_OPEN}`);
  await expect(page.getByTestId('active-questions-heading')).toBeVisible({ timeout: 10_000 });

  // Leave title blank, fill body
  await page.getByTestId('new-question-body').fill('Some body');
  await page.getByTestId('new-question-submit').click();

  // Error should appear, no navigation
  await expect(page.getByTestId('new-question-error')).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/questions/${Q_OPEN}`));
  // Still only 2 questions
  expect(state.questions).toHaveLength(2);
});

test('(d) Mark resolved changes to awaiting text with Withdraw button', async ({ page }) => {
  await mockApi(page);
  await signIn(page);
  await page.goto(`/#/projects/${PROJECT}/questions/${Q_OPEN}`);
  await expect(page.getByTestId('question-resolve')).toBeVisible({ timeout: 10_000 });

  await page.getByTestId('question-resolve').click();

  await expect(page.getByTestId('question-awaiting')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('question-awaiting')).toContainText("awaiting the other party's resolution");
  await expect(page.getByTestId('question-withdraw')).toBeVisible();
  await expect(page.getByTestId('question-resolve')).toHaveCount(0);
});

test('(e) Withdraw brings back Mark resolved', async ({ page }) => {
  await mockApi(page);
  await signIn(page);
  await page.goto(`/#/projects/${PROJECT}/questions/${Q_OPEN}`);
  await expect(page.getByTestId('question-resolve')).toBeVisible({ timeout: 10_000 });

  // First resolve
  await page.getByTestId('question-resolve').click();
  await expect(page.getByTestId('question-withdraw')).toBeVisible({ timeout: 10_000 });

  // Then withdraw
  await page.getByTestId('question-withdraw').click();
  await expect(page.getByTestId('question-resolve')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('question-awaiting')).toHaveCount(0);
});

test('(f) a resolved question shows Resolved and no composer', async ({ page }) => {
  await mockApi(page);
  await signIn(page);
  await page.goto(`/#/projects/${PROJECT}/questions/${Q_RESOLVED}`);
  await expect(page.getByTestId('active-questions-heading')).toBeVisible({ timeout: 10_000 });

  await expect(page.getByTestId('question-resolved')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('question-resolved')).toHaveText('Resolved');
  await expect(page.getByTestId('question-composer')).toHaveCount(0);
});
