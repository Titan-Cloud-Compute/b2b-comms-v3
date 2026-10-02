/**
 * Hermetic spec for the Projects and External Organization Spaces story.
 *
 * Every /api/** call is mocked here — nothing reaches the network.
 * Uses hash routing (/#/...) and pre-signed-in session mocks.
 */
import { test, expect, type Page } from '@playwright/test';

type Role = 'USER' | 'MANAGER' | 'ADMIN';

// ─── Fixture data ────────────────────────────────────────────────────────────

const PROJECTS_LIST = {
  items: [
    {
      id: 'p1',
      name: 'Acme Corp',
      status: 'active',
      organization: { id: 'org-1', name: 'Acme Corp', type: 'customer' },
    },
    {
      id: 'p2',
      name: 'Beta LLC',
      status: 'active',
      organization: { id: 'org-2', name: 'Beta LLC', type: 'vendor' },
    },
  ],
  page: 1,
  total: 2,
};

const PROJECT_P1 = {
  id: 'p1',
  name: 'Acme Corp',
  status: 'active',
  organization: { id: 'org-1', name: 'Acme Corp', type: 'customer' },
  default_channel_id: 'ch-1',
  members: [],
};

// ─── Mock helper ─────────────────────────────────────────────────────────────

async function mockApi(page: Page, role: Role): Promise<void> {
  const user = { id: 'u1', email: `${role.toLowerCase()}@example.com`, role };

  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const method = req.method().toUpperCase();
    const apiPath = new URL(req.url()).pathname
      .replace(/^.*\/api\//, '')
      .replace(/^api\//, '')
      .replace(/^\//, '');
    const json = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(body),
      });

    // ── Auth ──────────────────────────────────────────────────────────────
    if (method === 'GET' && apiPath === 'users/me') return json(user);
    if (method === 'POST' && apiPath === 'auth/login') return json(user);

    // ── Project list ──────────────────────────────────────────────────────
    if (method === 'GET' && apiPath === 'projects') return json(PROJECTS_LIST);

    // ── Project create ────────────────────────────────────────────────────
    if (method === 'POST' && apiPath === 'projects') {
      let body: { organization_name?: string; organization_type?: string } | null = null;
      try {
        body = (await req.postDataJSON()) as typeof body;
      } catch {
        // ignore parse errors
      }
      const name = (body?.organization_name ?? '').trim();
      if (!name) {
        return json({ message: 'organizationName must not be empty' }, 400);
      }
      return json(
        {
          id: 'p9',
          name,
          status: 'active',
          organization: { id: 'org-9', name, type: body?.organization_type ?? 'other' },
          default_channel_id: null,
          members: [],
        },
        201,
      );
    }

    // ── Project detail (any id) ───────────────────────────────────────────
    if (method === 'GET' && /^projects\/[^/]+$/.test(apiPath)) {
      const id = apiPath.slice('projects/'.length);
      if (id === 'p1') return json(PROJECT_P1);
      return json({
        id,
        name: 'Project ' + id,
        status: 'active',
        organization: { id: 'org-' + id, name: 'Project ' + id, type: 'other' },
        default_channel_id: null,
        members: [],
      });
    }

    // ── Invitations ───────────────────────────────────────────────────────
    if (method === 'POST' && /^projects\/[^/]+\/invitations$/.test(apiPath)) {
      return json(
        {
          id: 'inv-1',
          project_id: 'p1',
          email: 'test@example.com',
          status: 'pending',
          delivery: 'failed',
          expires_at: new Date(Date.now() + 7 * 864e5).toISOString(),
        },
        201,
      );
    }

    if (method === 'POST' && /^invitations\/[^/]+\/resend$/.test(apiPath)) {
      const invId = apiPath.split('/')[1];
      return json({
        id: invId,
        status: 'pending',
        delivery: 'sent',
        expires_at: new Date(Date.now() + 7 * 864e5).toISOString(),
      });
    }

    // ── Fallbacks ─────────────────────────────────────────────────────────
    if (method === 'GET') return json([]);
    return json({ ok: true });
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test.use({ serviceWorkers: 'block' });

test('signed-in / redirects to /projects and lists mocked projects with org names', async ({ page }) => {
  await mockApi(page, 'MANAGER');
  await page.goto('/#/');
  await expect(page).toHaveURL(/#\/projects/, { timeout: 10_000 });
  await expect(page.getByTestId('project-list')).toBeVisible();
  const rows = page.getByTestId('project-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText('Acme Corp');
  await expect(rows.nth(1)).toContainText('Beta LLC');
});

test('clicking a company name navigates to /projects/:id with heading, file explorer above chat', async ({ page }) => {
  await mockApi(page, 'MANAGER');
  await page.goto('/#/projects');
  await expect(page.getByTestId('project-list')).toBeVisible();
  // Click the first project link (org name "Acme Corp")
  await page.getByTestId('project-row').first().getByRole('link').click();
  await expect(page).toHaveURL(/#\/projects\/p1/, { timeout: 10_000 });
  await expect(page.getByTestId('project-heading')).toHaveText('Acme Corp');
  await expect(page.getByTestId('project-file-explorer')).toBeVisible();
  await expect(page.getByTestId('project-chat-area')).toBeVisible();
  // File explorer must appear above the chat area in the layout
  const fileBox = await page.getByTestId('project-file-explorer').boundingBox();
  const chatBox = await page.getByTestId('project-chat-area').boundingBox();
  expect(fileBox!.y).toBeLessThan(chatBox!.y);
});

test('MANAGER can create a project at /projects/new and land on the new project', async ({ page }) => {
  await mockApi(page, 'MANAGER');
  await page.goto('/#/projects/new');
  await expect(page.locator('#organizationName')).toBeVisible({ timeout: 10_000 });
  await page.locator('#organizationName').fill('New Company');
  await page.locator('#organizationType').selectOption('vendor');
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/#\/projects\/p9/, { timeout: 10_000 });
});

test('blank organization name on /projects/new shows a validation error', async ({ page }) => {
  await mockApi(page, 'MANAGER');
  await page.goto('/#/projects/new');
  await expect(page.locator('button[type="submit"]')).toBeVisible({ timeout: 10_000 });
  // Submit with blank name — client validates first
  await page.locator('button[type="submit"]').click();
  await expect(page.getByTestId('form-error')).toBeVisible();
});

test('invite with delivery=failed shows resend notice; Resend clears it', async ({ page }) => {
  await mockApi(page, 'MANAGER');
  await page.goto('/#/projects/p1');
  await expect(page.getByTestId('project-heading')).toBeVisible({ timeout: 10_000 });
  // Send invite
  await page.locator('#inviteEmail').fill('contact@external.example');
  await page.locator('button[type="submit"]').click();
  // Delivery-failed notice must appear
  await expect(page.getByTestId('invite-delivery-failed')).toBeVisible({ timeout: 10_000 });
  // Click Resend — mock returns delivery:'sent'
  await page.getByRole('button', { name: 'Resend' }).click();
  // Delivery-failed notice must disappear (now 'sent')
  await expect(page.getByTestId('invite-delivery-failed')).not.toBeVisible({ timeout: 10_000 });
});

test('Employee does not see the New project button', async ({ page }) => {
  await mockApi(page, 'USER');
  await page.goto('/#/projects');
  await expect(page.getByTestId('project-list-page')).toBeVisible({ timeout: 10_000 });
  // "New project" link must be absent for an Employee (USER role)
  await expect(page.getByTestId('new-project-link')).toHaveCount(0);
});
