/**
 * Hermetic spec for the Unread Message Indicators story.
 * Every /api/** call is mocked via page.route() — nothing reaches the network.
 * window.EventSource is replaced by a controllable fake so the test can push
 * unread.changed events.
 */
import { test, expect, type Page } from '@playwright/test';

const PROJECT_ID = 'p1';

interface MockState { reads: string[]; unread: Record<string, number> }

async function fakeEventSource(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    const sources: { url: string; listeners: Record<string, ((e: { data: string }) => void)[]> }[] = [];
    w['__sources'] = sources;
    w['EventSource'] = class FakeEventSource {
      listeners: Record<string, ((e: { data: string }) => void)[]> = {};
      constructor(public url: string) {
        sources.push(this);
      }
      close() {}
      addEventListener(type: string, fn: (e: { data: string }) => void) {
        (this.listeners[type] ??= []).push(fn);
      }
      removeEventListener() {}
      dispatchEvent() { return false; }
    };
    w['__emit'] = (type: string, data: unknown) => {
      for (const s of sources) for (const fn of s.listeners[type] ?? []) fn({ data: JSON.stringify(data) });
    };
  });
}

async function mockApi(page: Page): Promise<MockState> {
  const state: MockState = { reads: [], unread: { 'c-general': 3, 'c-design': 0 } };
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const method = req.method().toUpperCase();
    const apiPath = new URL(req.url()).pathname.replace(/^.*\/api\//, '');
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (method === 'GET' && apiPath === 'users/me') return json({ id: 'u-me', email: 'user@example.com', role: 'USER' });
    if (method === 'GET' && apiPath === `projects/${PROJECT_ID}/channels`) {
      return json({
        general: [
          { id: 'c-general', name: 'general', internal_only: false, unread_count: state.unread['c-general'] },
          { id: 'c-design', name: 'design', internal_only: false, unread_count: state.unread['c-design'] },
        ],
        questions: [],
      });
    }
    if (method === 'GET' && apiPath === `projects/${PROJECT_ID}/unread`) {
      return json({ counts: Object.entries(state.unread).map(([channel_id, unread_count]) => ({ channel_id, unread_count })) });
    }
    const read = /^channels\/([^/]+)\/read$/.exec(apiPath);
    if (method === 'POST' && read) {
      state.reads.push(read[1]);
      state.unread[read[1]] = 0;
      return json({ channel_id: read[1], last_read_message_id: 'm1', unread_count: 0 });
    }
    if (method === 'GET' && /^channels\/[^/]+\/messages/.test(apiPath)) return json({ items: [], next_cursor: null });
    if (method === 'GET') return json([]);
    return json({ ok: true });
  });
  return state;
}

async function gotoList(page: Page): Promise<void> {
  await page.goto(`/#/projects/${PROJECT_ID}/channels`);
  await expect(page.getByTestId('unread-channel-list')).toBeVisible({ timeout: 10_000 });
}

const item = (page: Page, id: string) => page.locator(`[data-testid="unread-channel-item"][data-channel-id="${id}"]`);

test('shows a bubble with the stored unread_count only for channels with unread messages', async ({ page }) => {
  await fakeEventSource(page);
  await mockApi(page);
  await gotoList(page);

  await expect(item(page, 'c-general').getByTestId('unread-bubble')).toHaveText('3');
  await expect(item(page, 'c-design')).toBeVisible();
  await expect(item(page, 'c-design').getByTestId('unread-bubble')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText(/page not found/i);
});

test('an unread.changed event raises the bubble from N to N+1 without a refresh', async ({ page }) => {
  await fakeEventSource(page);
  await mockApi(page);
  await gotoList(page);
  await expect(item(page, 'c-general').getByTestId('unread-bubble')).toHaveText('3');

  await page.evaluate(() =>
    (window as unknown as { __emit: (t: string, d: unknown) => void }).__emit('unread.changed', {
      type: 'unread.changed',
      channel_id: 'c-general',
      payload: { project_id: 'p1', unread_count: 4 },
    }),
  );
  await expect(item(page, 'c-general').getByTestId('unread-bubble')).toHaveText('4');

  await page.evaluate(() =>
    (window as unknown as { __emit: (t: string, d: unknown) => void }).__emit('unread.changed', {
      type: 'unread.changed',
      channel_id: 'c-design',
      payload: {},
    }),
  );
  await expect(item(page, 'c-design').getByTestId('unread-bubble')).toHaveText('1');
});

test('opening a channel marks it read and the bubble disappears', async ({ page }) => {
  await fakeEventSource(page);
  const state = await mockApi(page);
  await gotoList(page);
  await expect(item(page, 'c-general').getByTestId('unread-bubble')).toHaveText('3');

  await item(page, 'c-general').getByTestId('unread-channel-link').click();
  await expect.poll(() => state.reads).toContain('c-general');
  await expect(page).toHaveURL(/projects\/p1\/channels\/c-general/);

  await gotoList(page);
  await expect(item(page, 'c-general')).toBeVisible();
  await expect(item(page, 'c-general').getByTestId('unread-bubble')).toHaveCount(0);
});
