/**
 * Message Reference and Annotation — viewer tests.
 * Runs under playwright.hermetic.config.ts
 * (static SPA, hash routing, every /api/** call mocked — nothing reaches the network).
 */
import { test, expect, type Page } from '@playwright/test';

const USER = { id: 'u-1', email: 'user@example.com', role: 'USER', organizationId: 'org-1', active: true };

// A minimal 1×1 PNG in base64.
const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const TINY_PNG_BYTES = Buffer.from(TINY_PNG_B64, 'base64');

function makeReference(overrides: Partial<{
  can_edit: boolean;
  file_available: boolean;
}> = {}) {
  return {
    id: 'ref-1',
    message_id: 'msg-1',
    file_version_id: 'fv-1',
    page_number: 1,
    annotations: [
      { type: 'text', x: 0.1, y: 0.1, width: 0.3, height: 0.05, text: 'Hello annotation' },
      { type: 'path', points: [[0.2, 0.3], [0.4, 0.5], [0.6, 0.3]] },
    ],
    can_edit: overrides.can_edit ?? false,
    file_available: overrides.file_available ?? true,
    page_url: 'api/file-versions/fv-1/pages/1',
    file_name: 'spec.pdf',
    updated_at: '2026-09-01T10:00:00.000Z',
  };
}

async function mockApi(
  page: Page,
  opts: {
    can_edit?: boolean;
    file_available?: boolean;
    forbidden?: boolean;
  } = {},
): Promise<void> {
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const method = req.method().toUpperCase();
    const apiPath = new URL(req.url()).pathname
      .replace(/^.*\/api\//, '')
      .replace(/^api\//, '')
      .replace(/^\//, '');
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    // Auth
    if (method === 'GET' && (apiPath === 'users/me' || apiPath === 'auth/me')) {
      return json(USER);
    }

    // Reference endpoint
    if (method === 'GET' && apiPath === 'references/ref-1') {
      if (opts.forbidden) {
        return json({ message: 'Forbidden' }, 403);
      }
      return json(makeReference({ can_edit: opts.can_edit, file_available: opts.file_available }));
    }

    // Page image
    if (method === 'GET' && apiPath === 'file-versions/fv-1/pages/1') {
      return route.fulfill({ status: 200, contentType: 'image/png', body: TINY_PNG_BYTES });
    }

    // DELETE reference
    if (method === 'DELETE' && apiPath === 'references/ref-1') {
      return route.fulfill({ status: 204, body: '' });
    }

    // Fallback
    if (method === 'GET') return json([]);
    return json({ ok: true });
  });
}

test.use({ serviceWorkers: 'block' });

test('viewer shows page and overlay', async ({ page }) => {
  await mockApi(page);
  await page.goto('/#/projects/p-1/references/ref-1');
  await expect(page.locator('[data-testid="reference-viewer"]')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-testid="reference-page-image"]')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-testid="reference-overlay"]')).toBeVisible();
  // Both annotation types are rendered
  await expect(page.locator('[data-annotation="text"]')).toHaveCount(1);
  await expect(page.locator('[data-annotation="path"]')).toHaveCount(1);
  // No edit controls for non-author
  await expect(page.locator('[data-testid="reference-edit"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="reference-delete"]')).toHaveCount(0);
});

test('viewer read-only for non-author', async ({ page }) => {
  await mockApi(page, { can_edit: false });
  await page.goto('/#/projects/p-1/references/ref-1');
  await expect(page.locator('[data-testid="reference-viewer"]')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-testid="reference-edit"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="reference-delete"]')).toHaveCount(0);
});

test('viewer shows edit controls for author', async ({ page }) => {
  await mockApi(page, { can_edit: true });
  await page.goto('/#/projects/p-1/references/ref-1');
  await expect(page.locator('[data-testid="reference-viewer"]')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-testid="reference-edit"]')).toBeVisible();
  await expect(page.locator('[data-testid="reference-delete"]')).toBeVisible();
});

test('viewer file no longer available', async ({ page }) => {
  await mockApi(page, { file_available: false });
  await page.goto('/#/projects/p-1/references/ref-1');
  await expect(page.locator('[data-testid="reference-viewer"]')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-testid="reference-unavailable"]')).toContainText(
    'This file is no longer available',
  );
  await expect(page.locator('[data-testid="reference-page-image"]')).toHaveCount(0);
});
