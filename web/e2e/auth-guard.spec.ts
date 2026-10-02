/**
 * full_auth guard oracle: every shell / feature route is behind a
 * server-checked authGuard, '/' redirects by session, and login resumes the
 * interrupted page (returnUrl) for every role. Hermetic — every /api/** call
 * is mocked here; nothing reaches the network.
 */
import { test, expect, type Page } from '@playwright/test';

type Identity = {
  id: string;
  email: string;
  displayName: string;
  role: 'USER' | 'MANAGER' | 'ADMIN';
  organizationId: string;
  active: boolean;
};

const ACCOUNTS: Record<string, Identity> = {
  'user@demo.local': {
    id: 'u-1', email: 'user@demo.local', displayName: 'Demo User',
    role: 'USER', organizationId: 'org-external', active: true,
  },
  'manager@demo.local': {
    id: 'u-2', email: 'manager@demo.local', displayName: 'Demo Manager',
    role: 'MANAGER', organizationId: 'org-internal', active: true,
  },
  'admin@demo.local': {
    id: 'u-3', email: 'admin@demo.local', displayName: 'Demo Admin',
    role: 'ADMIN', organizationId: 'org-internal', active: true,
  },
  'disabled@demo.local': {
    id: 'u-4', email: 'disabled@demo.local', displayName: 'Disabled',
    role: 'USER', organizationId: 'org-external', active: false,
  },
};

async function mockApi(page: Page): Promise<{ meCalls: () => number }> {
  const store: { user: Identity | null; meCalls: number } = { user: null, meCalls: 0 };
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const method = req.method().toUpperCase();
    const apiPath = new URL(req.url()).pathname
      .replace(/^.*\/api\//, '').replace(/^api\//, '').replace(/^\//, '');
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (method === 'POST' && apiPath === 'auth/login') {
      const body = (req.postDataJSON() ?? {}) as { email?: string };
      const account = ACCOUNTS[(body.email ?? '').toLowerCase()];
      if (!account || !account.active) {
        store.user = null;
        return json({ message: 'invalid credentials' }, 401);
      }
      store.user = account;
      return json(account);
    }
    if (method === 'GET' && (apiPath === 'users/me' || apiPath === 'auth/me')) {
      store.meCalls += 1;
      return store.user ? json(store.user) : json({ message: 'Unauthorized' }, 401);
    }
    if (method === 'GET') return json([]);
    return json({ ok: true });
  });
  return { meCalls: () => store.meCalls };
}

async function submitLogin(page: Page, email: string): Promise<void> {
  await page.locator('#email').fill(email);
  await page.locator('#password').fill('password1234');
  await page.locator('button[type="submit"]').click();
}

test.use({ serviceWorkers: 'block' });

test('signed-out visit to /dashboard is sent to /login with returnUrl and no shell', async ({ page }) => {
  await mockApi(page);
  await page.goto('/#/dashboard');
  await expect(page).toHaveURL(/#\/login\?returnUrl=%2Fdashboard/, { timeout: 10_000 });
  await expect(page.locator('#email')).toBeVisible();
  await expect(page.locator('#password')).toBeVisible();
  await expect(page.locator('aside.sidebar')).toHaveCount(0);
});

test('signed-out visit to / redirects to /login', async ({ page }) => {
  await mockApi(page);
  await page.goto('/#/');
  await expect(page).toHaveURL(/#\/login/, { timeout: 10_000 });
  await expect(page.locator('aside.sidebar')).toHaveCount(0);
});

for (const email of ['user@demo.local', 'manager@demo.local', 'admin@demo.local']) {
  const role = ACCOUNTS[email].role;
  test(`${role} resumes the returnUrl after login with their real role`, async ({ page }) => {
    await mockApi(page);
    await page.goto('/#/settings');
    await expect(page).toHaveURL(/#\/login\?returnUrl=%2Fsettings/, { timeout: 10_000 });
    await submitLogin(page, email);
    await expect(page).toHaveURL(/#\/settings$/, { timeout: 10_000 });
    await expect(page.locator('aside.sidebar')).toBeVisible();
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('user') ?? 'null'));
    expect(stored?.role).toBe(role);
    expect(stored?.organizationId).toBe(ACCOUNTS[email].organizationId);
  });
}

test('signed-in visit to / redirects into the app, not to login', async ({ page }) => {
  await mockApi(page);
  await page.goto('/#/login');
  await submitLogin(page, 'user@demo.local');
  await expect(page).toHaveURL(/#\/dashboard/, { timeout: 10_000 });
  await page.goto('/#/');
  await expect(page).not.toHaveURL(/#\/login/, { timeout: 10_000 });
  await expect(page.locator('aside.sidebar')).toBeVisible();
});

test('a deactivated account is refused and stays on login', async ({ page }) => {
  await mockApi(page);
  await page.goto('/#/dashboard');
  await expect(page).toHaveURL(/#\/login\?returnUrl=%2Fdashboard/, { timeout: 10_000 });
  await submitLogin(page, 'disabled@demo.local');
  await expect(page.locator('body')).toContainText(/invalid email or password/i);
  await expect(page).toHaveURL(/#\/login/);
  await expect(page.locator('aside.sidebar')).toHaveCount(0);
});

test('a stale local session is checked by the server and bounced with returnUrl', async ({ page }) => {
  const api = await mockApi(page);
  await page.addInitScript(() => {
    localStorage.setItem('user', JSON.stringify({
      id: 'u-stale', email: 'stale@demo.local', name: 'Stale', role: 'USER',
    }));
  });
  await page.goto('/#/dashboard');
  await expect(page).toHaveURL(/#\/login\?returnUrl=%2Fdashboard/, { timeout: 10_000 });
  expect(api.meCalls()).toBeGreaterThan(0);
  await expect(page.locator('aside.sidebar')).toHaveCount(0);
});
