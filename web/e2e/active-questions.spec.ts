/**
 * Active Questions oracle. Runs under playwright.hermetic.config.ts
 * (static SPA, hash routing, every /api/** call mocked — nothing reaches the network).
 */
import { test, expect, type Page } from '@playwright/test';

const PROJECT = 'p-1';
const CHANNEL = 'q-1';

interface MockState {
  questions: Record<string, unknown>[];
  messages: Record<string, unknown>[];
  resolvedSides: string[];
  questionStatus: 'open' | 'resolved';
  postedQuestions: unknown[];
  postedMessages: unknown[];
  resolveCallCount: number;
  withdrawCallCount: number;
}

async function mockApi(page: Page, opts: { resolvedQuestion?: boolean } = {}): Promise<MockState> {
  const user = {
    id: 'u-1',
    email: 'user@example.com',
    name: 'Test User',
    role: 'USER',
    organizationId: 'org-1',
    active: true,
  };

  const state: MockState = {
    questions: [
      {
        id: CHANNEL,
        projectId: PROJECT,
        title: 'How does pricing work?',
        status: opts.resolvedQuestion ? 'resolved' : 'open',
        createdBy: 'u-1',
        createdAt: '2026-01-01T00:00:00Z',
        resolvedSides: opts.resolvedQuestion ? ['internal', 'external'] : [],
        mySide: 'internal',
      },
    ],
    messages: [
      {
        id: 'm-1',
        channelId: CHANNEL,
        authorId: 'u-1',
        bodyHtml: '<p>Can you explain the pricing?</p>',
        createdAt: '2026-01-01T00:00:01Z',
      },
    ],
    resolvedSides: opts.resolvedQuestion ? ['internal', 'external'] : [],
    questionStatus: opts.resolvedQuestion ? 'resolved' : 'open',
    postedQuestions: [],
    postedMessages: [],
    resolveCallCount: 0,
    withdrawCallCount: 0,
  };

  let seq = 10;

  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const method = req.method().toUpperCase();
    const apiPath = new URL(req.url()).pathname
      .replace(/^.*\/api\//, '')
      .replace(/^api\//, '')
      .replace(/^\//, '');

    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    // Auth
    if (method === 'POST' && apiPath === 'auth/login') {
      return json(user);
    }
    if (method === 'POST' && apiPath === 'auth/logout') {
      return route.fulfill({ status: 204, body: '' });
    }
    if (method === 'GET' && (apiPath === 'users/me' || apiPath === 'auth/me')) {
      return json(user);
    }

    // List questions for project
    if (method === 'GET' && apiPath === `projects/${PROJECT}/questions`) {
      return json(state.questions);
    }

    // Create question
    if (method === 'POST' && apiPath === `projects/${PROJECT}/questions`) {
      const body = req.postDataJSON() as { title: string; body_html: string };
      if (!body.title || !body.title.trim()) {
        return json({ message: 'Title is required' }, 400);
      }
      const created = {
        id: `q-${++seq}`,
        projectId: PROJECT,
        title: body.title,
        status: 'open',
        createdBy: user.id,
        createdAt: new Date().toISOString(),
        resolvedSides: [],
        mySide: 'internal',
      };
      state.questions.push(created);
      state.postedQuestions.push(body);
      state.messages.push({
        id: `m-${++seq}`,
        channelId: created.id,
        authorId: user.id,
        bodyHtml: body.body_html,
        createdAt: new Date().toISOString(),
      });
      return json(created, 201);
    }

    // Resolve question
    const resolveMatch = /^questions\/([^/]+)\/resolve$/.exec(apiPath);
    if (resolveMatch) {
      const qId = resolveMatch[1];
      const q = state.questions.find(x => x['id'] === qId);
      if (!q) return json({ message: 'Not found' }, 404);
      if (method === 'POST') {
        state.resolveCallCount++;
        // Add mySide to resolvedSides
        const sides = (q['resolvedSides'] as string[]);
        const mySide = q['mySide'] as string;
        if (!sides.includes(mySide)) sides.push(mySide);
        state.resolvedSides = sides;
        return json({ ...q });
      }
      if (method === 'DELETE') {
        state.withdrawCallCount++;
        // Remove mySide from resolvedSides
        const mySide = q['mySide'] as string;
        (q['resolvedSides'] as string[]).splice(0);
        state.resolvedSides = [];
        return json({ ...q });
      }
    }

    // Messages for a channel
    const msgsMatch = /^channels\/([^/]+)\/messages$/.exec(apiPath);
    if (msgsMatch) {
      const cId = msgsMatch[1];
      if (method === 'GET') {
        return json(state.messages.filter(m => m['channelId'] === cId));
      }
      if (method === 'POST') {
        const body = req.postDataJSON() as { bodyHtml: string };
        const created = {
          id: `m-${++seq}`,
          channelId: cId,
          authorId: user.id,
          bodyHtml: body.bodyHtml,
          createdAt: new Date().toISOString(),
        };
        state.messages.push(created);
        state.postedMessages.push(body);
        return json(created, 201);
      }
    }

    if (method === 'GET') return json([]);
    return json({ ok: true });
  });

  return state;
}

const questionUrl = `/#/projects/${PROJECT}/questions/${CHANNEL}`;

test.use({ serviceWorkers: 'block' });

test('(a) shows Active Questions heading and seeded question item', async ({ page }) => {
  await mockApi(page);
  await page.goto(questionUrl);
  await expect(page.getByTestId('active-questions-heading')).toHaveText('Active Questions', { timeout: 10_000 });
  await expect(page.getByTestId('question-item')).toHaveCount(1);
  await expect(page.getByTestId('question-item').first()).toContainText('How does pricing work?');
});

test('(b) creating a question adds it to the list and navigates to it', async ({ page }) => {
  const state = await mockApi(page);
  await page.goto(questionUrl);
  await expect(page.getByTestId('active-questions-heading')).toBeVisible({ timeout: 10_000 });

  await page.getByTestId('new-question-title').fill('What is the SLA?');
  await page.getByTestId('new-question-body').fill('<p>Please clarify the SLA terms.</p>');
  await page.getByTestId('new-question-submit').click();

  // Should navigate to the new question's URL
  await expect(page).toHaveURL(/questions\/q-11/, { timeout: 10_000 });
  // New question should appear in the list
  await expect(page.getByTestId('question-item')).toHaveCount(2, { timeout: 10_000 });
  expect(state.postedQuestions).toHaveLength(1);
});

test('(c) blank title submit sends no POST', async ({ page }) => {
  const state = await mockApi(page);
  await page.goto(questionUrl);
  await expect(page.getByTestId('active-questions-heading')).toBeVisible({ timeout: 10_000 });

  // Leave title blank, click submit
  await page.getByTestId('new-question-body').fill('<p>some body</p>');
  await page.getByTestId('new-question-submit').click();

  // No POST should have been made
  await expect(page.getByTestId('create-question-error')).toBeVisible({ timeout: 5_000 });
  expect(state.postedQuestions).toHaveLength(0);
  // URL should remain unchanged
  expect(page.url()).toContain(CHANNEL);
});

test('(d) clicking Mark resolved shows awaiting message', async ({ page }) => {
  await mockApi(page);
  await page.goto(questionUrl);
  await expect(page.getByTestId('question-resolve')).toBeVisible({ timeout: 10_000 });

  await page.getByTestId('question-resolve').click();

  await expect(page.getByTestId('question-awaiting')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('question-awaiting')).toContainText("awaiting the other party's resolution");
  await expect(page.getByTestId('question-withdraw')).toBeVisible();
  await expect(page.getByTestId('question-resolve')).toHaveCount(0);
});

test('(e) Withdraw after marking resolved brings back Mark resolved', async ({ page }) => {
  await mockApi(page);
  await page.goto(questionUrl);
  await expect(page.getByTestId('question-resolve')).toBeVisible({ timeout: 10_000 });

  await page.getByTestId('question-resolve').click();
  await expect(page.getByTestId('question-withdraw')).toBeVisible({ timeout: 10_000 });

  await page.getByTestId('question-withdraw').click();
  await expect(page.getByTestId('question-resolve')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('question-awaiting')).toHaveCount(0);
});

test('(f) a resolved question shows Resolved and no composer', async ({ page }) => {
  await mockApi(page, { resolvedQuestion: true });
  await page.goto(questionUrl);
  await expect(page.getByTestId('question-resolved')).toHaveText('Resolved', { timeout: 10_000 });
  await expect(page.getByTestId('question-composer')).toHaveCount(0);
  await expect(page.getByTestId('question-resolve')).toHaveCount(0);
});

test('messages are shown in the thread pane', async ({ page }) => {
  await mockApi(page);
  await page.goto(questionUrl);
  await expect(page.getByTestId('question-message')).toHaveCount(1, { timeout: 10_000 });
  await expect(page.getByTestId('question-message').first()).toContainText('Can you explain the pricing?');
});
