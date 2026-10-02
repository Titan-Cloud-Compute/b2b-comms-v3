/**
 * Foundation: auth (full_auth) — the Angular shell is guarded by a
 * server-checked authGuard that honours returnUrl.
 *
 * Runs under playwright.hermetic.config.ts (static SPA, hash routing); every
 * /api/** call is mocked here so nothing reaches the network.
 */
import { test, expect, type Page } from '@playwright/test';

type Identity = { id: string; email: string; name: string; role: string; organizationId: string };

const ACCOUNTS: Record<string, Identity> = {
  'user@demo.local': { id: 'u1', email: 'user@demo.local', name: 'User', role: 'USER', organizationId: 'org-ext' },
  'manager@demo.local': { id: 'u2', email: 'manager@demo.local', name: 'Manager', role: 'MANAGER', organizationId: 'org-int' },
  'admin@demo.local': { id: 'u3', email: 'admin@demo.local', name: 'Admin', role: 'ADMIN', organizationId: 'org-int' },
};

async function mockApi(page: Page): Promise<{ meCalls: () => number }> {
  const store: { user: Identity | null } = { user: null };
  let me = 0;
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const method = req.method().toUpperCase();
    const apiPath = new URL(req.url()).pathname
      .replace(/^.*\/api\//, '').replace(/^api\//, '').replace(/^\//, '');
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (method === 'POST' && apiPath === 'auth/login') {
      const { email } = JSON.parse(req.postData() ?? '{}') as { email?: string };
      const account = email ? ACCOUNTS[email] : undefined;
      if (!account) return json({ message: 'invalid credentials' }, 401);
      store.user = account;
      return json(account);
    }
    if (method === 'GET' && (apiPath === 'users/me' || apiPath === 'auth/me')) {
      me++;
      return store.user ? json(store.user) : json({ message: 'Unauthorized' }, 401);
    }
    if (method === 'GET') return json([]);
    return json({ ok: true });
  });
  return { meCalls: () => me };
}

test.use({ serviceWorkers: 'block' });

test('signed-out visit to /dashboard shows login with returnUrl and no sidebar shell', async ({ page }) => {
  await mockApi(page);
  await page.goto('/#/dashboard');
  await expect(page.locator('#email')).toBeVisible({ timeout: 10_000 });
  expect(page.url()).toContain('#/login?returnUrl=%2Fdashboard');
  await expect(page.locator('aside.sidebar')).toHaveCount(0);
});

test('a stale cached user is not trusted — the server decides', async ({ page }) => {
  const api = await mockApi(page);
  await page.addInitScript(() => {
    localStorage.setItem('user', JSON.stringify({ id: 'ghost', email: 'ghost@x.y', name: 'g', role: 'ADMIN' }));
    localStorage.setItem('isAuthenticated', 'true');
  });
  await page.goto('/#/admin/users');
  await expect(page.locator('#email')).toBeVisible({ timeout: 10_000 });
  expect(page.url()).toContain('returnUrl=%2Fadmin%2Fusers');
  await expect(page.locator('aside.sidebar')).toHaveCount(0);
  expect(api.meCalls()).toBeGreaterThan(0);
});

for (const email of Object.keys(ACCOUNTS)) {
  test(`${ACCOUNTS[email].role} signs in and is returned to /dashboard`, async ({ page }) => {
    await mockApi(page);
    await page.goto('/#/dashboard');
    await expect(page.locator('#email')).toBeVisible({ timeout: 10_000 });
    await page.locator('#email').fill(email);
    await page.locator('#password').fill('password1234');
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/#\/dashboard$/, { timeout: 10_000 });
    await expect(page.locator('aside.sidebar')).toBeVisible();
    const role = await page.evaluate(() => JSON.parse(localStorage.getItem('user') ?? '{}').role);
    expect(role).toBe(ACCOUNTS[email].role);
  });
}
