/**
 * Hermetic spec for the General Channels story.
 * Every /api/** call is mocked via page.route() — nothing reaches the network.
 * window.EventSource is stubbed via addInitScript so the SSE code path is inert.
 */
import { test, expect, type Page } from '@playwright/test';

const PROJECT_ID = 'p1';
const CHANNEL_ID = 'c-general';

type Role = 'USER' | 'MANAGER';

interface MockMessage {
  id: string;
  channel_id: string;
  author: { id: string; display_name: string };
  body_html: string;
  attachments: { file_id: string; name: string }[];
  reference_id: null;
  edited_at: string | null;
  created_at: string;
}

interface MockState {
  user: { id: string; email: string; role: Role };
  messages: MockMessage[];
  nextMsgId: number;
  posts: number;
}

/** Replace window.EventSource with a no-op stub so SSE never opens a real connection. */
async function stubEventSource(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>)['EventSource'] = class FakeEventSource {
      constructor(_url: string, _opts?: EventSourceInit) {}
      close() {}
      addEventListener() {}
      removeEventListener() {}
      dispatchEvent() { return false; }
    };
  });
}

async function mockApi(
  page: Page,
  role: Role = 'MANAGER',
  initialMessages: MockMessage[] = [],
): Promise<MockState> {
  const state: MockState = {
    user: { id: 'u-me', email: `${role.toLowerCase()}@example.com`, role },
    messages: [...initialMessages],
    nextMsgId: 10,
    posts: 0,
  };

  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const method = req.method().toUpperCase();
    const url = new URL(req.url());
    const apiPath = url.pathname.replace(/^.*\/api\//, '').replace(/^\//, '');
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (method === 'GET' && apiPath === 'users/me') return json(state.user);

    if (method === 'GET' && apiPath === `projects/${PROJECT_ID}/channels`) {
      return json({
        general: [{ id: CHANNEL_ID, name: 'general', internal_only: false, unread_count: 0 }],
        questions: [],
      });
    }

    if (method === 'GET' && apiPath === `channels/${CHANNEL_ID}/messages`) {
      // Return newest-first; component does .reverse() to display oldest-first.
      return json({ items: [...state.messages].reverse(), next_cursor: null });
    }

    if (method === 'POST' && apiPath === `channels/${CHANNEL_ID}/messages`) {
      state.posts++;
      const body = (await req.postDataJSON()) as { body_html?: string; file_ids?: string[] };
      const id = `m${state.nextMsgId++}`;
      const created_at = new Date().toISOString();
      state.messages.push({
        id,
        channel_id: CHANNEL_ID,
        author: { id: state.user.id, display_name: state.user.email },
        body_html: body.body_html ?? '',
        attachments: [],
        reference_id: null,
        edited_at: null,
        created_at,
      });
      return json({ id, channel_id: CHANNEL_ID, author_id: state.user.id, body_html: body.body_html ?? '', created_at }, 201);
    }

    if (method === 'PATCH' && /^messages\/[^/]+$/.test(apiPath)) {
      const msgId = apiPath.split('/')[1];
      const body = (await req.postDataJSON()) as { body_html?: string };
      const msg = state.messages.find((m) => m.id === msgId);
      if (msg) {
        msg.body_html = body.body_html ?? msg.body_html;
        msg.edited_at = new Date().toISOString();
        return json({ id: msgId, body_html: msg.body_html, edited_at: msg.edited_at });
      }
      return json({});
    }

    if (method === 'DELETE' && /^messages\/[^/]+$/.test(apiPath)) {
      const msgId = apiPath.split('/')[1];
      state.messages = state.messages.filter((m) => m.id !== msgId);
      return route.fulfill({ status: 204 });
    }

    if (method === 'GET') return json([]);
    return json({ ok: true });
  });

  return state;
}

test.use({ serviceWorkers: 'block' });

async function gotoChannel(page: Page): Promise<void> {
  await page.goto(`/#/projects/${PROJECT_ID}/channels/${CHANNEL_ID}`);
  await expect(page.getByTestId('general-channel-page')).toBeVisible({ timeout: 10_000 });
}

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

test('lists "general" under General Channels', async ({ page }) => {
  await stubEventSource(page);
  await mockApi(page);
  await gotoChannel(page);

  const section = page.getByTestId('general-channels-section');
  await expect(section).toBeVisible();
  await expect(section).toContainText('General Channels');
  await expect(section.getByTestId('general-channel-item')).toContainText('general');
});

test('MANAGER sees the create-channel form', async ({ page }) => {
  await stubEventSource(page);
  await mockApi(page, 'MANAGER');
  await gotoChannel(page);
  await expect(page.getByTestId('create-channel-form')).toBeVisible();
});

test('USER (employee) does not see the create-channel form', async ({ page }) => {
  await stubEventSource(page);
  await mockApi(page, 'USER');
  await gotoChannel(page);
  await expect(page.getByTestId('create-channel-form')).toHaveCount(0);
});

test('bold message renders as <b> element', async ({ page }) => {
  await stubEventSource(page);
  await mockApi(page);
  await gotoChannel(page);

  // Set bold HTML directly into the contenteditable composer, then send.
  await page.getByTestId('composer-input').evaluate((el) => {
    (el as HTMLDivElement).innerHTML = '<b>hello</b>';
  });
  await page.getByTestId('composer-send').click();

  // The confirmed message body should contain a <b> with the expected text.
  const body = page.getByTestId('message-body').last();
  await expect(body.locator('b')).toContainText('hello');
});

test('script tags in message body_html are not rendered', async ({ page }) => {
  await stubEventSource(page);
  await mockApi(page, 'MANAGER', [
    {
      id: 'm1',
      channel_id: CHANNEL_ID,
      author: { id: 'u-attacker', display_name: 'Attacker' },
      body_html: 'safe text <script>window.__xss=1</script>',
      attachments: [],
      reference_id: null,
      edited_at: null,
      created_at: new Date().toISOString(),
    },
  ]);
  await gotoChannel(page);

  const body = page.getByTestId('message-body').first();
  await expect(body).toContainText('safe text');

  // Angular's [innerHTML] sanitizer must have stripped the <script> element.
  await expect(body.locator('script')).toHaveCount(0);

  // Verify no script executed.
  const injected = await page.evaluate(
    () => (window as unknown as Record<string, unknown>)['__xss'],
  );
  expect(injected).toBeUndefined();
});

test("own message shows Edit and Delete; another author's message does not", async ({ page }) => {
  await stubEventSource(page);
  await mockApi(page, 'MANAGER', [
    {
      id: 'm1',
      channel_id: CHANNEL_ID,
      author: { id: 'u-me', display_name: 'Me' },
      body_html: 'my message',
      attachments: [],
      reference_id: null,
      edited_at: null,
      created_at: '2026-01-01T10:00:00.000Z',
    },
    {
      id: 'm2',
      channel_id: CHANNEL_ID,
      author: { id: 'u-other', display_name: 'Other' },
      body_html: 'other message',
      attachments: [],
      reference_id: null,
      edited_at: null,
      created_at: '2026-01-01T10:01:00.000Z',
    },
  ]);
  await gotoChannel(page);

  // Mock returns newest-first; component reverses → oldest-first in DOM.
  // m1 (mine, older) is at index 0; m2 (other, newer) at index 1.
  const articles = page.getByTestId('message');
  await expect(articles).toHaveCount(2);

  const myMsg = articles.nth(0); // m1 — authored by u-me
  await expect(myMsg.getByTestId('message-edit')).toBeVisible();
  await expect(myMsg.getByTestId('message-delete')).toBeVisible();

  const otherMsg = articles.nth(1); // m2 — authored by u-other
  await expect(otherMsg.getByTestId('message-edit')).toHaveCount(0);
  await expect(otherMsg.getByTestId('message-delete')).toHaveCount(0);
});

test('editing a message shows the "edited" label', async ({ page }) => {
  await stubEventSource(page);
  await mockApi(page, 'MANAGER', [
    {
      id: 'm1',
      channel_id: CHANNEL_ID,
      author: { id: 'u-me', display_name: 'Me' },
      body_html: 'original text',
      attachments: [],
      reference_id: null,
      edited_at: null,
      created_at: '2026-01-01T10:00:00.000Z',
    },
  ]);
  await gotoChannel(page);

  await page.getByTestId('message-edit').click();

  const editBox = page.getByTestId('message-edit-input');
  await expect(editBox).toBeVisible();
  await editBox.fill('updated text');
  await page.getByTestId('message-edit-save').click();

  // After saving, the "(edited)" label must appear.
  await expect(page.getByTestId('message-edited')).toBeVisible();
});

test('offline send shows "pending" label; clears after reconnect', async ({ page, context }) => {
  await stubEventSource(page);
  const state = await mockApi(page);
  await gotoChannel(page);

  // Ensure the channel list loaded before going offline.
  await expect(page.getByTestId('general-channels-section')).toBeVisible();

  // Simulate network loss — also fires the browser 'offline' event.
  await context.setOffline(true);

  const input = page.getByTestId('composer-input');
  await input.click();
  await input.type('offline message');
  await page.getByTestId('composer-send').click();

  // The pending label must appear immediately (no network needed).
  await expect(page.getByTestId('message-pending')).toBeVisible();

  // Restore connectivity — fires the browser 'online' event.
  // The component handles it with reconnected() → flushPending() → POST.
  await context.setOffline(false);

  // Pending label must clear once the POST is sent and succeeds.
  await expect(page.getByTestId('message-pending')).toHaveCount(0, { timeout: 10_000 });

  // The POST must have been sent.
  expect(state.posts).toBeGreaterThan(0);
});
