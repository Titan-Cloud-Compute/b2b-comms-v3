/**
 * Public /accept-invite/:token page: renders for a signed-out visitor (no
 * bounce to /login), posts to /api/invitations/accept and shows the server's
 * 400 error message. Hermetic: every /api/** call is mocked.
 */
import { test, expect, type Page } from '@playwright/test';

async function mockApi(page: Page, posted: unknown[]): Promise<void> {
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const method = req.method().toUpperCase();
    const apiPath = new URL(req.url()).pathname
      .replace(/^.*\/api\//, '').replace(/^api\//, '').replace(/^\//, '');
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (method === 'POST' && apiPath === 'invitations/accept') {
      posted.push(req.postDataJSON());
      return json({ statusCode: 400, message: 'Invitation has expired' }, 400);
    }
    if (method === 'GET' && apiPath === 'users/me') {
      return json({ message: 'Unauthorized' }, 401);
    }
    if (method === 'GET') return json([]);
    return json({ ok: true });
  });
}

test.use({ serviceWorkers: 'block' });

test('signed-out visitor sees the accept-invite form', async ({ page }) => {
  await mockApi(page, []);
  await page.goto('/#/accept-invite/test-invite-token');
  const form = page.locator('[data-testid="accept-invite-form"]');
  await expect(form).toBeVisible({ timeout: 10_000 });
  await expect(form.locator('input[name="display_name"]')).toBeVisible();
  await expect(form.locator('input[type="password"]')).toBeVisible();
  expect(page.url()).not.toMatch(/#\/login/);
});

test('submitting posts the token and shows the server 400 message', async ({ page }) => {
  const posted: unknown[] = [];
  await mockApi(page, posted);
  await page.goto('/#/accept-invite/test-invite-token');
  const form = page.locator('[data-testid="accept-invite-form"]');
  await expect(form).toBeVisible({ timeout: 10_000 });
  await form.locator('input[name="display_name"]').fill('Invited Contact');
  await form.locator('input[type="password"]').fill('password1234');
  await form.locator('button[type="submit"]').click();
  await expect(page.locator('[data-testid="accept-invite-error"]')).toHaveText('Invitation has expired', { timeout: 10_000 });
  expect(posted).toEqual([
    { token: 'test-invite-token', display_name: 'Invited Contact', password: 'password1234' },
  ]);
  expect(page.url()).not.toMatch(/#\/login/);
});
