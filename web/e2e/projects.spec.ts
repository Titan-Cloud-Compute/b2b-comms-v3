/**
 * Projects screens oracle. Runs under playwright.hermetic.config.ts
 * (static SPA, hash routing, every /api/** call mocked).
 */
import { test, expect, type Page } from '@playwright/test';

const PROJECTS = [
  { id: 'p-1', name: 'Acme', status: 'active', organizationId: 'o-1', organizationName: 'Acme Corp', organizationType: 'vendor', createdAt: '2026-01-01T00:00:00Z' },
  { id: 'p-2', name: 'Globex', status: 'active', organizationId: 'o-2', organizationName: 'Globex Inc', organizationType: 'client', createdAt: '2026-01-02T00:00:00Z' },
];

async function mockApi(page: Page, role: string): Promise<{ created: unknown[] }> {
  const state = { created: [] as unknown[] };
  const user = { id: 'u-1', email: 'u@example.com', name: 'U', role, organizationId: 'org-int', active: true };
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const method = req.method().toUpperCase();
    const apiPath = new URL(req.url()).pathname.replace(/^.*\/api\//, '');
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (method === 'GET' && (apiPath === 'users/me' || apiPath === 'auth/me')) return json(user);
    if (method === 'GET' && apiPath === 'projects') {
      return json({ items: PROJECTS, total: PROJECTS.length, page: 1, pageSize: 25 });
    }
    if (method === 'POST' && apiPath === 'projects') {
      if (role === 'USER') return json({ message: 'Forbidden' }, 403);
      const body = req.postDataJSON() as { organizationName: string; organizationType: string };
      state.created.push(body);
      return json({ ...PROJECTS[0], id: 'p-new', organizationName: body.organizationName, organizationType: body.organizationType }, 201);
    }
    const one = /^projects\/([^/]+)$/.exec(apiPath);
    if (method === 'GET' && one) {
      const p = PROJECTS.find((x) => x.id === one[1]) ?? (one[1] === 'p-new' ? { ...PROJECTS[0], id: 'p-new' } : null);
      return p ? json(p) : json({ message: 'Forbidden' }, 403);
    }
    if (method === 'GET') return json([]);
    return json({ ok: true });
  });
  return state;
}

test.use({ serviceWorkers: 'block' });

test('projects list renders with heading and organization names', async ({ page }) => {
  await mockApi(page, 'USER');
  await page.goto('/#/projects');
  await expect(page.getByTestId('projects-heading')).toHaveText('Projects', { timeout: 10_000 });
  await expect(page.getByTestId('project-list')).toBeVisible();
  await expect(page.getByTestId('project-link')).toHaveText(['Acme Corp', 'Globex Inc']);
  await expect(page.getByTestId('new-project')).toHaveCount(0);
  expect(page.url()).not.toContain('/login');
});

test('clicking a company name opens the project space with files above chat', async ({ page }) => {
  await mockApi(page, 'USER');
  await page.goto('/#/projects');
  await page.getByTestId('project-link').filter({ hasText: 'Globex Inc' }).click();
  await expect(page).toHaveURL(/#\/projects\/p-2$/, { timeout: 10_000 });
  const files = page.getByTestId('file-explorer');
  const chat = page.getByTestId('chat-area');
  await expect(files).toBeVisible();
  await expect(chat).toBeVisible();
  const fb = await files.boundingBox();
  const cb = await chat.boundingBox();
  expect(fb && cb && fb.y < cb.y).toBeTruthy();
});

test('a manager creates a project from the new project form', async ({ page }) => {
  const state = await mockApi(page, 'MANAGER');
  await page.goto('/#/projects');
  await page.getByTestId('new-project').click();
  await expect(page).toHaveURL(/#\/projects\/new$/, { timeout: 10_000 });
  await page.getByTestId('org-name').fill('Initech');
  await page.getByTestId('org-type').selectOption('customer');
  await page.getByTestId('create-project').click();
  await expect(page).toHaveURL(/#\/projects\/p-new$/, { timeout: 10_000 });
  expect(state.created).toEqual([{ organizationName: 'Initech', organizationType: 'customer' }]);
});

test('a blank organization name is rejected client-side', async ({ page }) => {
  const state = await mockApi(page, 'MANAGER');
  await page.goto('/#/projects/new');
  await page.getByTestId('create-project').click();
  await expect(page.getByTestId('new-project-error')).toBeVisible({ timeout: 10_000 });
  expect(state.created).toEqual([]);
});
