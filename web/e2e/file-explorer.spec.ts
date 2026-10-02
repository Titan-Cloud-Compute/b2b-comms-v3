/**
 * File Explorer story. Runs under playwright.hermetic.config.ts
 * (static SPA, hash routing, every /api/** call mocked — nothing reaches the network).
 */
import { test, expect, type Page } from '@playwright/test';

const USER = { id: 'u-1', email: 'user@example.com', role: 'USER', organizationId: 'org-1', active: true };

async function mockApi(page: Page, opts: { storageDown?: boolean } = {}): Promise<{ uploads: number }> {
  const state = { uploads: 0 };
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const method = req.method().toUpperCase();
    const apiPath = new URL(req.url()).pathname
      .replace(/^.*\/api\//, '').replace(/^api\//, '').replace(/^\//, '');
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (method === 'GET' && (apiPath === 'users/me' || apiPath === 'auth/me')) return json(USER);
    if (method === 'GET' && apiPath === 'projects/p-1/files') {
      const folderId = new URL(req.url()).searchParams.get('folderId');
      if (folderId === 'fo-1') {
        return json({ folderId, breadcrumbs: [{ id: 'fo-1', name: 'Drawings' }], folders: [], files: [] });
      }
      return json({
        folderId: null,
        breadcrumbs: [],
        folders: [{ id: 'fo-1', kind: 'folder', name: 'Drawings', parentId: null }],
        files: [{
          id: 'f-1', kind: 'file', name: 'spec.pdf', mimeType: 'application/pdf', sizeBytes: 2048,
          uploaderName: 'Ada Uploader', uploadedAt: '2026-09-01T10:00:00.000Z', folderId: null,
        }],
      });
    }
    if (method === 'POST' && apiPath === 'projects/p-1/files') {
      state.uploads++;
      if (opts.storageDown) return json({ statusCode: 503, message: 'File storage is temporarily unavailable', retryable: true }, 503);
      return json({ files: [] }, 201);
    }
    if (method === 'GET') return json([]);
    return json({ ok: true });
  });
  return state;
}

test.use({ serviceWorkers: 'block' });

test('explorer lists files with name, size, type, uploader and date', async ({ page }) => {
  await mockApi(page);
  await page.goto('/#/projects/p-1/files');
  await expect(page.locator('[data-testid="file-explorer"]')).toBeVisible({ timeout: 10_000 });
  const row = page.locator('[data-testid="file-row"]').first();
  await expect(row).toContainText('spec.pdf');
  await expect(row).toContainText('2.0 KB');
  await expect(row).toContainText('application/pdf');
  await expect(row).toContainText('Ada Uploader');
  await expect(row).toContainText('2026');
  expect(page.url()).not.toContain('/login');
});

test('list/grid toggle switches the view', async ({ page }) => {
  await mockApi(page);
  await page.goto('/#/projects/p-1/files');
  const list = page.locator('[data-testid="file-list"]');
  await expect(list).toHaveAttribute('data-view', 'list', { timeout: 10_000 });
  await page.locator('[data-testid="view-toggle-grid"]').click();
  await expect(list).toHaveAttribute('data-view', 'grid');
  await page.locator('[data-testid="view-toggle-list"]').click();
  await expect(list).toHaveAttribute('data-view', 'list');
});

test('folder route renders breadcrumbs', async ({ page }) => {
  await mockApi(page);
  await page.goto('/#/projects/p-1/files/fo-1');
  await expect(page.locator('[data-testid="breadcrumb"]')).toContainText('Drawings', { timeout: 10_000 });
  expect(page.url()).not.toContain('/login');
});

test('storage outage on upload shows a retry action', async ({ page }) => {
  const state = await mockApi(page, { storageDown: true });
  await page.goto('/#/projects/p-1/files');
  await expect(page.locator('[data-testid="file-explorer"]')).toBeVisible({ timeout: 10_000 });
  await page.locator('[data-testid="file-upload-input"]').setInputFiles({
    name: 'a.txt', mimeType: 'text/plain', buffer: Buffer.from('hello'),
  });
  await expect(page.locator('[data-testid="retry-action"]')).toBeVisible();
  await page.locator('[data-testid="retry-action"]').click();
  await expect.poll(() => state.uploads).toBe(2);
});
