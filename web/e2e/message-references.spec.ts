/**
 * Message Reference and Annotation — viewer tests.
 * Runs under playwright.hermetic.config.ts
 * (static SPA, hash routing, every /api/** call mocked — nothing reaches the network).
 */
import { test, expect, type Page } from '@playwright/test';

const USER = { id: 'u-1', email: 'user@example.com', role: 'USER', organizationId: 'org-1', active: true };

/** Minimal 1×1 transparent PNG (base64). */
const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function tinyPngBuffer(): Buffer {
  return Buffer.from(TINY_PNG_B64, 'base64');
}

const BASE_REFERENCE = {
  id: 'ref-1',
  messageId: 'msg-1',
  fileVersionId: 'fv-1',
  pageNumber: 3,
  annotations: [
    { type: 'text', x: 0.1, y: 0.2, width: 0.3, height: 0.05, text: 'Hello annotation' },
    { type: 'path', points: [[0.0, 0.0], [0.5, 0.5], [1.0, 0.0]] },
  ],
  authorId: 'u-1',
  canEdit: false,
  fileAvailable: true,
  pageUrl: '/api/file-versions/fv-1/pages/3',
  fileName: 'spec.pdf',
  updatedAt: '2026-09-01T10:00:00.000Z',
};

async function mockApi(
  page: Page,
  reference: typeof BASE_REFERENCE = BASE_REFERENCE,
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

    if (method === 'GET' && (apiPath === 'users/me' || apiPath === 'auth/me')) {
      return json(USER);
    }
    if (method === 'GET' && apiPath === `references/${reference.id}`) {
      return json(reference);
    }
    if (method === 'DELETE' && apiPath === `references/${reference.id}`) {
      return route.fulfill({ status: 204, body: '' });
    }
    // Serve the tiny PNG for the page image URL.
    if (method === 'GET' && apiPath.startsWith('file-versions/')) {
      return route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: tinyPngBuffer(),
      });
    }
    if (method === 'GET') return json([]);
    return json({ ok: true });
  });
}

test.use({ serviceWorkers: 'block' });

test('viewer shows page and overlay', async ({ page }) => {
  await mockApi(page);
  await page.goto('/#/projects/p-1/references/ref-1');
  const panel = page.locator('[data-testid="reference-viewer"]');
  await expect(panel).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-testid="reference-page-image"]')).toBeVisible();
  await expect(page.locator('[data-testid="reference-overlay"]')).toBeVisible();
  // Two annotations rendered.
  await expect(page.locator('[data-annotation]')).toHaveCount(2);
  // No edit/delete controls when can_edit is false.
  await expect(page.locator('[data-testid="reference-edit"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="reference-delete"]')).toHaveCount(0);
});

test('viewer read-only for non-author', async ({ page }) => {
  const ref = { ...BASE_REFERENCE, canEdit: false, authorId: 'u-other' };
  await mockApi(page, ref);
  await page.goto('/#/projects/p-1/references/ref-1');
  await expect(page.locator('[data-testid="reference-viewer"]')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-testid="reference-edit"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="reference-delete"]')).toHaveCount(0);
});

test('viewer shows edit controls for author', async ({ page }) => {
  const ref = { ...BASE_REFERENCE, canEdit: true };
  await mockApi(page, ref);
  await page.goto('/#/projects/p-1/references/ref-1');
  await expect(page.locator('[data-testid="reference-viewer"]')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-testid="reference-edit"]')).toBeVisible();
  await expect(page.locator('[data-testid="reference-delete"]')).toBeVisible();
});

test('viewer file no longer available', async ({ page }) => {
  const ref = { ...BASE_REFERENCE, fileAvailable: false, pageUrl: '' };
  await mockApi(page, ref);
  await page.goto('/#/projects/p-1/references/ref-1');
  await expect(page.locator('[data-testid="reference-viewer"]')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-testid="reference-page-image"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="reference-unavailable"]')).toContainText(
    'This file is no longer available',
  );
});
