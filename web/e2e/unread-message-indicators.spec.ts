/**
 * Hermetic spec for the Unread Message Indicators story.
 * Every /api/** call is mocked via page.route(); window.EventSource is replaced by a
 * controllable fake so the test can push `unread.changed` events.
 */
import { test, expect, type Page } from '@playwright/test';

const PROJECT_ID = 'p1';

interface MockState { counts: Record<string, number>; reads: string[] }

async function fakeEventSource(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    const instances: unknown[] = [];
    w['__esInstances'] = instances;
    w['EventSource'] = class FakeEventSource {
      url: string;
      listeners: Record<string, ((ev: { data: string }) => void)[]> = {};
      constructor(url: string) {
        this.url = url;
        instances.push(this);
      }
      addEventListener(type: string, fn: (ev: { data: string }) => void) {
        (this.listeners[type] ||= []).push(fn);
      }
      removeEventListener() {}
      close() {}
      dispatchEvent() { return false; }
      emit(type: string, data: unknown) {
        for (const fn of this.listeners[type] ?? []) fn({ data: JSON.stringify(data) });
      }
    };
  });
}

async function emitUnread(page: Page, channelId: string, payload: Record<string, unknown>): Promise<void> {
  await page.evaluate(
    ([id, p]) => {
      const list = (window as unknown as { __esInstances: { url: string; emit: (t: string, d: unknown) => void }[] }).__esInstances;
      for (const es of list) {
        if (es.url.includes(`realtime/socket?channel_id=${id}`)) es.emit('unread.changed', { type: 'unread.changed', channel_id: id, payload: p });
      }
    },
    [channelId, payload] as const,
  );
}

async function mockApi(page: Page): Promise<MockState> {
  const state: MockState = { counts: { 'c-general': 3, 'c-design': 0 }, reads: [] };
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
          { id: 'c-general', name: 'general', internal_only: false, unread_count: state.counts['c-general'] },
          { id: 'c-design', name: 'design', internal_only: false, unread_count: 0 },
        ],
        questions: [],
      });
    }
    if (method === 'GET' && apiPath === `projects/${PROJECT_ID}/unread`) {
      return json({ counts: Object.entries(state.counts).map(([channel_id, unread_count]) => ({ channel_id, unread_count })) });
    }
    const read = /^channels\/([^/]+)\/read$/.exec(apiPath);
    if (method === 'POST' && read) {
      state.reads.push(read[1]);
      state.counts[read[1]] = 0;
      return json({ channel_id: read[1], last_read_message_id: 'm1', unread_count: 0 });
    }
    if (method === 'GET' && /^channels\/[^/]+\/messages$/.test(apiPath)) return json({ items: [], next_cursor: null });
    if (method === 'GET') return json([]);
    return json({ ok: true });
  });
  return state;
}

test.use({ serviceWorkers: 'block' });

async function gotoList(page: Page): Promise<void> {
  await page.goto(`/#/projects/${PROJECT_ID}/channels`);
  await expect(page.getByTestId('unread-channel-list')).toBeVisible({ timeout: 10_000 });
}

const item = (page: Page, id: string) => page.locator(`[data-testid="unread-channel-item"][data-channel-id="${id}"]`);

test('shows the stored unread_count as a bubble and none for zero', async ({ page }) => {
  await fakeEventSource(page);
  await mockApi(page);
  await gotoList(page);
  await expect(item(page, 'c-general').getByTestId('unread-bubble')).toHaveText('3');
  await expect(item(page, 'c-design').getByTestId('unread-bubble')).toHaveCount(0);
  await expect(page.getByTestId('unread-error')).toHaveCount(0);
});

test('bubble rises from N to N+1 on unread.changed without a refresh', async ({ page }) => {
  await fakeEventSource(page);
  await mockApi(page);
  await gotoList(page);
  await expect(item(page, 'c-general').getByTestId('unread-bubble')).toHaveText('3');
  const urls = await page.evaluate(() =>
    (window as unknown as { __esInstances: { url: string }[] }).__esInstances.map((e) => e.url),
  );
  expect(urls.some((u) => u.includes('realtime/socket?channel_id=c-general'))).toBe(true);
  await emitUnread(page, 'c-general', { unread_count: 4 });
  await expect(item(page, 'c-general').getByTestId('unread-bubble')).toHaveText('4');
  await emitUnread(page, 'c-design', {});
  await expect(item(page, 'c-design').getByTestId('unread-bubble')).toHaveText('1');
});

test('opening a channel marks it read and the bubble disappears', async ({ page }) => {
  await fakeEventSource(page);
  const state = await mockApi(page);
  await gotoList(page);
  await item(page, 'c-general').getByTestId('unread-channel-link').click();
  await expect.poll(() => state.reads).toContain('c-general');
  await page.goto(`/#/projects/${PROJECT_ID}/channels`);
  await expect(page.getByTestId('unread-channel-list')).toBeVisible({ timeout: 10_000 });
  await expect(item(page, 'c-general').getByTestId('unread-bubble')).toHaveCount(0);
});
