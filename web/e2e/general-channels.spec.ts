/**
 * General Channels oracle. Runs under playwright.hermetic.config.ts
 * (static SPA, hash routing, every /api/** call mocked).
 */
import { test, expect, type Page } from '@playwright/test';

const PROJECT = 'p-1';
const CHANNEL = 'c-1';

interface MockState {
  channels: Record<string, unknown>[];
  messages: Record<string, unknown>[];
  createdChannels: unknown[];
  postedMessages: { bodyHtml: string }[];
  liveEvent: Record<string, unknown> | null;
}

async function mockApi(page: Page, role: string): Promise<MockState> {
  const user = { id: 'u-1', email: 'u@example.com', name: 'U', role, organizationId: 'org-int', active: true };
  const state: MockState = {
    channels: [
      { id: CHANNEL, projectId: PROJECT, kind: 'general', name: 'general', internalOnly: false, status: 'open', createdAt: '2026-01-01T00:00:00Z' },
    ],
    messages: [
      { id: 'm-1', channelId: CHANNEL, authorId: 'u-2', authorName: 'Ann', bodyHtml: '<b>Welcome</b> aboard', attachments: [], editedAt: null, deletedAt: null, createdAt: '2026-01-01T00:00:01Z' },
      { id: 'm-2', channelId: CHANNEL, authorId: 'u-1', authorName: 'U', bodyHtml: 'fixed typo', attachments: [], editedAt: '2026-01-01T00:00:05Z', deletedAt: null, createdAt: '2026-01-01T00:00:02Z' },
      { id: 'm-3', channelId: CHANNEL, authorId: 'u-2', authorName: 'Ann', bodyHtml: '', attachments: [], editedAt: null, deletedAt: '2026-01-01T00:00:06Z', createdAt: '2026-01-01T00:00:03Z' },
    ],
    createdChannels: [],
    postedMessages: [],
    liveEvent: null,
  };
  let seq = 10;
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const method = req.method().toUpperCase();
    const apiPath = new URL(req.url()).pathname.replace(/^.*\/api\//, '');
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (method === 'GET' && (apiPath === 'users/me' || apiPath === 'auth/me')) return json(user);
    if (apiPath === 'realtime/socket') {
      const events = state.liveEvent
        ? `event: message.created\ndata: ${JSON.stringify(state.liveEvent)}\n\n`
        : '';
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body: `retry: 600000\n\n${events}` });
    }
    if (apiPath === `projects/${PROJECT}/channels`) {
      if (method === 'GET') return json(state.channels);
      if (method === 'POST') {
        if (role === 'USER') return json({ message: 'Forbidden' }, 403);
        const body = req.postDataJSON() as { name: string; internalOnly: boolean };
        state.createdChannels.push(body);
        const created = { id: `c-${++seq}`, projectId: PROJECT, kind: 'general', name: body.name, internalOnly: body.internalOnly, status: 'open', createdAt: new Date().toISOString() };
        state.channels.push(created);
        return json(created, 201);
      }
    }
    const msgs = /^channels\/([^/]+)\/messages$/.exec(apiPath);
    if (msgs) {
      if (method === 'GET') return json(state.messages.filter((m) => m['channelId'] === msgs[1]));
      if (method === 'POST') {
        const body = req.postDataJSON() as { bodyHtml: string };
        state.postedMessages.push(body);
        const created = { id: `m-${++seq}`, channelId: msgs[1], authorId: user.id, authorName: user.name, bodyHtml: body.bodyHtml, attachments: [], editedAt: null, deletedAt: null, createdAt: new Date().toISOString() };
        state.messages.push(created);
        return json(created, 201);
      }
    }
    const one = /^messages\/([^/]+)$/.exec(apiPath);
    if (one) {
      const m = state.messages.find((x) => x['id'] === one[1]);
      if (!m) return json({ message: 'Not found' }, 404);
      if (m['authorId'] !== user.id) return json({ message: 'Forbidden' }, 403);
      if (method === 'PATCH') {
        Object.assign(m, { bodyHtml: (req.postDataJSON() as { bodyHtml: string }).bodyHtml, editedAt: new Date().toISOString() });
        return json(m);
      }
      if (method === 'DELETE') {
        Object.assign(m, { bodyHtml: '', deletedAt: new Date().toISOString() });
        return route.fulfill({ status: 204, body: '' });
      }
    }
    if (method === 'GET') return json([]);
    return json({ ok: true });
  });
  return state;
}

const channelUrl = `/#/projects/${PROJECT}/channels/${CHANNEL}`;

test.use({ serviceWorkers: 'block' });

test('channel page lists general channels and messages with edited/removed labels', async ({ page }) => {
  await mockApi(page, 'USER');
  await page.goto(channelUrl);
  await expect(page.getByTestId('channel-page')).toBeVisible({ timeout: 10_000 });
  expect(page.url()).not.toContain('/login');
  await expect(page.getByTestId('general-channels-heading')).toHaveText('General Channels');
  await expect(page.getByTestId('channel-link')).toHaveText(['# general']);
  await expect(page.getByTestId('message')).toHaveCount(3);
  await expect(page.getByTestId('message-body').first()).toContainText('Welcome');
  await expect(page.locator('[data-testid="message-body"] b').first()).toHaveText('Welcome');
  await expect(page.getByTestId('message-edited')).toHaveCount(1);
  await expect(page.getByTestId('message-removed')).toHaveText('Message removed');
  // Employees get no create-channel form.
  await expect(page.getByTestId('create-channel')).toHaveCount(0);
});

test('a manager creates a general channel and it appears under General Channels', async ({ page }) => {
  const state = await mockApi(page, 'MANAGER');
  await page.goto(channelUrl);
  await page.getByTestId('new-channel-name').fill('design');
  await page.getByTestId('new-channel-internal').check();
  await page.getByTestId('create-channel').click();
  await expect(page.getByTestId('channel-link')).toHaveText(['# general', '# design'], { timeout: 10_000 });
  await expect(page.getByTestId('channel-internal')).toHaveCount(1);
  expect(state.createdChannels).toEqual([{ name: 'design', internalOnly: true }]);
});

test('a member posts a formatted message from the rich composer', async ({ page }) => {
  const state = await mockApi(page, 'USER');
  await page.goto(channelUrl);
  await expect(page.getByTestId('message')).toHaveCount(3, { timeout: 10_000 });
  await page.getByTestId('composer').evaluate((el) => { el.innerHTML = '<b>bold</b> and <i>italic</i><ul><li>item</li></ul>'; });
  await page.getByTestId('send-message').click();
  await expect(page.getByTestId('message')).toHaveCount(4);
  await expect(page.locator('[data-testid="message-body"] i').last()).toHaveText('italic');
  expect(state.postedMessages).toHaveLength(1);
  expect(state.postedMessages[0].bodyHtml).toContain('<b>bold</b>');
  expect(state.postedMessages[0].bodyHtml).toContain('<li>item</li>');
});

test('a blank message is rejected client-side', async ({ page }) => {
  const state = await mockApi(page, 'USER');
  await page.goto(channelUrl);
  await expect(page.getByTestId('message')).toHaveCount(3, { timeout: 10_000 });
  await page.getByTestId('send-message').click();
  await expect(page.getByTestId('composer-error')).toBeVisible();
  expect(state.postedMessages).toHaveLength(0);
});

test('authors can edit and delete their own messages only', async ({ page }) => {
  await mockApi(page, 'USER');
  await page.goto(channelUrl);
  await expect(page.getByTestId('message')).toHaveCount(3, { timeout: 10_000 });
  // Only m-2 is authored by the signed-in user.
  await expect(page.getByTestId('edit-message')).toHaveCount(1);
  await page.getByTestId('edit-message').click();
  await page.getByTestId('edit-input').evaluate((el) => { el.innerHTML = 'rewritten'; });
  await page.getByTestId('save-edit').click();
  await expect(page.getByTestId('message-body').filter({ hasText: 'rewritten' })).toHaveCount(1);
  await page.getByTestId('delete-message').click();
  await expect(page.getByTestId('message-removed')).toHaveCount(2);
});

test('a message pushed over the realtime socket appears live', async ({ page }) => {
  const state = await mockApi(page, 'USER');
  state.liveEvent = {
    type: 'message.created',
    channelId: CHANNEL,
    projectId: PROJECT,
    payload: { id: 'm-live', channelId: CHANNEL, authorId: 'u-3', authorName: 'Bob', bodyHtml: '<i>pushed live</i>', attachments: [], editedAt: null, deletedAt: null, createdAt: '2026-01-01T00:00:09Z' },
  };
  await page.goto(channelUrl);
  await expect(page.getByTestId('message-body').filter({ hasText: 'pushed live' })).toHaveCount(1, { timeout: 10_000 });
});

test('messages sent offline show pending and are retried on reconnect', async ({ page }) => {
  const state = await mockApi(page, 'USER');
  await page.goto(channelUrl);
  await expect(page.getByTestId('message')).toHaveCount(3, { timeout: 10_000 });
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
    window.dispatchEvent(new Event('offline'));
  });
  await page.getByTestId('composer').evaluate((el) => { el.innerHTML = 'sent while offline'; });
  await page.getByTestId('send-message').click();
  await expect(page.getByTestId('message-pending')).toHaveText('pending');
  expect(state.postedMessages).toHaveLength(0);

  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
    window.dispatchEvent(new Event('online'));
  });
  await expect(page.getByTestId('message-pending')).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByTestId('message-body').filter({ hasText: 'sent while offline' })).toHaveCount(1);
  expect(state.postedMessages).toEqual([{ bodyHtml: 'sent while offline' }]);
});
