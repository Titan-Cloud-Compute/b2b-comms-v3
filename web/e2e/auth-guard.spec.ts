/**
 * full_auth guard: signed-out visitors are bounced to /login with a returnUrl,
 * the server session (users/me) is honoured, and every role — USER, MANAGER,
 * ADMIN — is returned to the interrupted route after signing in.
 * Hermetic: every /api/** call is mocked.
 */
import { test, expect, type Page } from '@playwright/test';

type Role = 'USER' | 'MANAGER' | 'ADMIN';

async function mockApi(page: Page, role: Role, signedIn = false): Promise<void> {
  const store: { user: { id: string; email: string; role: Role } | null } = {
    user: signedIn ? { id: 's1', email: 'session@example.com', role } : null,
  };
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const method = req.method().toUpperCase();
    const apiPath = new URL(req.url()).pathname
      .replace(/^.*\/api\//, '').replace(/^api\//, '').replace(/^\//, '');
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (method === 'POST' && apiPath === 'auth/login') {
      store.user = { id: '1', email: `${role.toLowerCase()}@example.com`, role };
      return json(store.user);
    }
    if (method === 'GET' && apiPath === 'users/me') {
      return store.user ? json(store.user) : json({ message: 'Unauthorized' }, 401);
    }
    if (method === 'GET') return json([]);
    return json({ ok: true });
  });
}

test.use({ serviceWorkers: 'block' });

for (const path of ['/', '/settings', '/dashboard', '/admin/users']) {
  test(`signed-out ${path} lands on /login without the shell`, async ({ page }) => {
    await mockApi(page, 'USER');
    await page.goto(`/#${path}`);
    await expect(page).toHaveURL(/#\/login/, { timeout: 10_000 });
    await expect(page.locator('#email')).toBeVisible();
    await expect(page.locator('aside.sidebar')).toHaveCount(0);
  });
}

test('signed-out deep link carries returnUrl', async ({ page }) => {
  await mockApi(page, 'USER');
  await page.goto('/#/settings');
  await expect(page).toHaveURL(/#\/login/, { timeout: 10_000 });
  expect(decodeURIComponent(page.url())).toContain('returnUrl=/settings');
});

for (const role of ['USER', 'MANAGER', 'ADMIN'] as Role[]) {
  test(`${role} is returned to the deep link after signing in`, async ({ page }) => {
    await mockApi(page, role);
    await page.goto('/#/settings');
    await expect(page.locator('#email')).toBeVisible({ timeout: 10_000 });
    await page.locator('#email').fill(`${role.toLowerCase()}@example.com`);
    await page.locator('#password').fill('password1234');
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/#\/settings/, { timeout: 10_000 });
    await expect(page.locator('aside.sidebar')).toBeVisible();
  });
}

test('an existing server session (users/me) is honoured without a login', async ({ page }) => {
  await mockApi(page, 'MANAGER', true);
  await page.goto('/#/settings');
  await expect(page).toHaveURL(/#\/settings/, { timeout: 10_000 });
  await expect(page.locator('aside.sidebar')).toBeVisible();
});
