/**
 * Auth guard oracle (full_auth foundation). Runs under playwright.hermetic.config.ts
 * (static SPA, hash routing, every /api/** call mocked — nothing reaches the network).
 */
import { test, expect, type Page } from '@playwright/test';

type MockUser = { id: string; email: string; role: string; organizationId: string | null; active: boolean };

async function mockApi(page: Page, role = 'USER'): Promise<void> {
  const store: { user: MockUser | null } = { user: null };
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const method = req.method().toUpperCase();
    const apiPath = new URL(req.url()).pathname
      .replace(/^.*\/api\//, '').replace(/^api\//, '').replace(/^\//, '');
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (method === 'POST' && apiPath === 'auth/login') {
      store.user = { id: 'u-1', email: 'user@example.com', role, organizationId: 'org-1', active: true };
      return json(store.user);
    }
    if (method === 'POST' && apiPath === 'auth/logout') {
      store.user = null;
      return route.fulfill({ status: 204, body: '' });
    }
    if (method === 'GET' && (apiPath === 'users/me' || apiPath === 'auth/me')) {
      return store.user ? json(store.user) : json({ message: 'Unauthorized' }, 401);
    }
    if (method === 'GET') return json([]);
    return json({ ok: true });
  });
}

test.use({ serviceWorkers: 'block' });

test('signed-out visit to an inner page redirects to /login carrying returnUrl', async ({ page }) => {
  await mockApi(page);
  await page.goto('/#/dashboard');
  await expect(page).toHaveURL(/#\/login\?returnUrl=%2Fdashboard/, { timeout: 10_000 });
  await expect(page.locator('#email')).toBeVisible();
  await expect(page.locator('aside.sidebar')).toHaveCount(0);
});

test('signed-out visit to settings is also guarded', async ({ page }) => {
  await mockApi(page);
  await page.goto('/#/settings');
  await expect(page).toHaveURL(/#\/login\?returnUrl=%2Fsettings/, { timeout: 10_000 });
});

test('signing in honours returnUrl', async ({ page }) => {
  await mockApi(page);
  await page.goto('/#/settings');
  await expect(page.locator('#email')).toBeVisible({ timeout: 10_000 });
  await page.locator('#email').fill('user@example.com');
  await page.locator('#password').fill('password1234');
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/#\/settings/, { timeout: 10_000 });
  await expect(page.locator('aside.sidebar')).toBeVisible();
});

test('a MANAGER can sign in and reach the shell', async ({ page }) => {
  await mockApi(page, 'MANAGER');
  await page.goto('/#/login');
  await page.locator('#email').fill('manager@example.com');
  await page.locator('#password').fill('password1234');
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/#\/dashboard/, { timeout: 10_000 });
  await expect(page.locator('aside.sidebar')).toBeVisible();
});
