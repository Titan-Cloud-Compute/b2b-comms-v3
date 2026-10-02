/**
 * Hermetic spec for the File Explorer story.
 * Every /api/** call is mocked here — nothing reaches the network.
 */
import { test, expect, type Page } from '@playwright/test';

const ROOT = {
  folder: { id: null, name: 'Acme Corp', breadcrumbs: [{ id: null, name: 'Acme Corp' }] },
  folders: [{ id: 'fo1', name: 'Contracts', parent_id: null }],
  files: [
    {
      id: 'fi1', name: 'brief.pdf', mime_type: 'application/pdf', size_bytes: 2048,
      uploaded_by: 'u1', uploaded_at: '2026-01-01T00:00:00.000Z', version_number: 2,
    },
  ],
};
const SUB = {
  folder: {
    id: 'fo1', name: 'Contracts',
    breadcrumbs: [{ id: null, name: 'Acme Corp' }, { id: 'fo1', name: 'Contracts' }],
  },
  folders: [],
  files: [],
};

async function mockApi(page: Page, opts: { uploadStatus?: number } = {}): Promise<{ uploads: number }> {
  const state = { uploads: 0 };
  const user = { id: 'u1', email: 'manager@example.com', role: 'MANAGER' };
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const method = req.method().toUpperCase();
    const url = new URL(req.url());
    const apiPath = url.pathname.replace(/^.*\/api\//, '').replace(/^\//, '');
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (method === 'GET' && apiPath === 'users/me') return json(user);
    if (method === 'GET' && apiPath === 'projects/p1/files') {
      const q = url.searchParams.get('q');
      if (q) return json({ ...ROOT, folders: [], files: ROOT.files.filter((f) => f.name.includes(q)) });
      return json(url.searchParams.get('folder_id') === 'fo1' ? SUB : ROOT);
    }
    if (method === 'POST' && apiPath === 'projects/p1/files') {
      state.uploads++;
      if (opts.uploadStatus === 503 && state.uploads === 1) {
        return json({ statusCode: 503, message: 'Storage service is unavailable. Please retry.', retryable: true }, 503);
      }
      return json({ items: [] }, 201);
    }
    if (method === 'GET' && apiPath === 'files/fi1/versions') {
      return json({
        items: [
          { id: 'v2', version_number: 2, size_bytes: 2048, uploaded_by: 'u1', uploaded_at: '2026-01-02T00:00:00.000Z' },
          { id: 'v1', version_number: 1, size_bytes: 1024, uploaded_by: 'u1', uploaded_at: '2026-01-01T00:00:00.000Z' },
        ],
      });
    }
    if (method === 'GET') return json([]);
    return json({ ok: true });
  });
  return state;
}

test.use({ serviceWorkers: 'block' });

test('renders explorer with breadcrumbs, items, view toggle and upload control', async ({ page }) => {
  await mockApi(page);
  await page.goto('/#/projects/p1/files');
  await expect(page.getByTestId('file-explorer')).toBeVisible({ timeout: 10_000 });
  await expect(page).not.toHaveURL(/#\/login/);
  await expect(page.getByTestId('fe-breadcrumbs')).toContainText('Acme Corp');
  await expect(page.getByTestId('fe-folder')).toHaveCount(1);
  await expect(page.getByTestId('fe-file')).toContainText('brief.pdf');
  await expect(page.getByTestId('fe-upload-input')).toBeAttached();

  await expect(page.getByTestId('fe-items')).toHaveAttribute('data-view', 'list');
  await page.getByTestId('fe-view-toggle').click();
  await expect(page.getByTestId('fe-items')).toHaveAttribute('data-view', 'grid');
});

test('navigates into a folder and back via breadcrumbs', async ({ page }) => {
  await mockApi(page);
  await page.goto('/#/projects/p1/files');
  await page.getByTestId('fe-folder').getByRole('link').click();
  await expect(page).toHaveURL(/#\/projects\/p1\/files\/fo1/);
  await expect(page.getByTestId('fe-breadcrumbs')).toContainText('Contracts');
  await expect(page.getByTestId('fe-empty')).toBeVisible();
  await page.getByTestId('fe-breadcrumbs').getByRole('link', { name: 'Acme Corp' }).click();
  await expect(page.getByTestId('fe-file')).toHaveCount(1);
});

test('shows version history', async ({ page }) => {
  await mockApi(page);
  await page.goto('/#/projects/p1/files');
  await page.getByTestId('fe-versions').click();
  await expect(page.getByTestId('fe-versions-panel')).toContainText('v1');
  await expect(page.getByTestId('fe-versions-panel')).toContainText('v2');
});

test('rejects empty uploads client-side', async ({ page }) => {
  const state = await mockApi(page);
  await page.goto('/#/projects/p1/files');
  await page.getByTestId('fe-upload-input').setInputFiles({ name: 'empty.txt', mimeType: 'text/plain', buffer: Buffer.alloc(0) });
  await expect(page.getByTestId('fe-error')).toContainText('empty');
  expect(state.uploads).toBe(0);
});

test('offers retry when storage returns 503', async ({ page }) => {
  const state = await mockApi(page, { uploadStatus: 503 });
  await page.goto('/#/projects/p1/files');
  await page.getByTestId('fe-upload-input').setInputFiles({ name: 'a.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await expect(page.getByTestId('fe-retry')).toBeVisible();
  await page.getByTestId('fe-retry').click();
  await expect(page.getByTestId('fe-error')).toHaveCount(0);
  expect(state.uploads).toBe(2);
});
