/**
 * Auth guard oracle: the authenticated shell is guarded by a server-checked
 * authGuard; a signed-out visitor is sent to /login with a returnUrl, and after
 * signing in is returned to the page they asked for. Every /api/** call is
 * mocked — nothing reaches the network.
 */
import { test, expect, type Page } from '@playwright/test';

async function mockApi(page: Page): Promise<void> {
  const store: { user: Record<string, unknown> | null } = { user: null };
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const method = req.method().toUpperCase();
    const apiPath = new URL(req.url()).pathname
      .replace(/^.*\/api\//, '').replace(/^api\//, '').replace(/^\//, '');
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (method === 'POST' && apiPath === 'auth/login') {
      store.user = {
        id: 'm1', email: 'manager@demo.local', name: 'Manager', role: 'MANAGER',
        organizationId: 'org-1', active: true,
      };
      return json(store.user);
    }
    if (method === 'POST' && apiPath === 'auth/logout') {
      store.user = null;
      return json({ ok: true });
    }
    if (method === 'GET' && (apiPath === 'auth/me' || apiPath === 'users/me')) {
      return store.user ? json(store.user) : json({ message: 'Unauthorized' }, 401);
    }
    if (method === 'GET') return json([]);
    return json({ ok: true });
  });
}

test.use({ serviceWorkers: 'block' });
test.beforeEach(async ({ page }) => { await mockApi(page); });

test('signed-out visitor to a guarded route is sent to /login with returnUrl', async ({ page }) => {
  await page.goto('/#/settings');
  await expect(page).toHaveURL(/#\/login/, { timeout: 10_000 });
  expect(decodeURIComponent(page.url())).toContain('returnUrl=/settings');
  await expect(page.locator('#email')).toBeVisible();
  await expect(page.locator('aside.sidebar')).toHaveCount(0);
});

test('a stale local session is not trusted without the server', async ({ page }) => {
  await page.goto('/#/login');
  await page.evaluate(() => {
    localStorage.setItem('user', JSON.stringify({ id: 'x', email: 'x@y.z', name: 'X', role: 'USER' }));
  });
  await page.goto('/#/dashboard');
  await expect(page).toHaveURL(/#\/login/, { timeout: 10_000 });
});

test('after signing in the visitor is returned to the returnUrl', async ({ page }) => {
  await page.goto('/#/settings');
  await expect(page).toHaveURL(/#\/login/, { timeout: 10_000 });
  await page.locator('#email').fill('manager@demo.local');
  await page.locator('#password').fill('password1234');
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/#\/settings/, { timeout: 10_000 });
});
