/**
 * Message Reference and Annotation story. Runs under playwright.hermetic.config.ts
 * (static SPA, hash routing, every /api/** call mocked — nothing reaches the network).
 */
import { test, expect, type Page } from '@playwright/test';

const USER = { id: 'u-viewer', email: 'viewer@example.com', role: 'USER', organizationId: 'org-1', active: true };
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=',
  'base64',
);
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const ANNOTATIONS = [
  { type: 'text', x: 0.2, y: 0.3, text: 'Check this dimension' },
  { type: 'stroke', points: [[0.1, 0.1], [0.3, 0.4], [0.5, 0.45]] },
];

function reference(overrides: Record<string, unknown> = {}) {
  return {
    id: 'r-1', message_id: 'm-1', project_id: 'p-1', file_id: 'f-1', file_name: 'plan.pdf',
    mime_type: 'application/pdf', file_version_id: 'v-1', page_number: 3, annotations: ANNOTATIONS,
    author_id: 'u-author', updated_at: '2026-09-01T10:00:00.000Z', can_edit: false, file_available: true,
    ...overrides,
  };
}

interface MockState { created: unknown[]; pageRequests: string[] }

async function mockApi(page: Page, ref: Record<string, unknown> = reference()): Promise<MockState> {
  const state: MockState = { created: [], pageRequests: [] };
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const method = req.method().toUpperCase();
    const apiPath = new URL(req.url()).pathname
      .replace(/^.*\/api\//, '').replace(/^api\//, '').replace(/^\//, '');
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (method === 'GET' && (apiPath === 'users/me' || apiPath === 'auth/me')) return json(USER);
    if (method === 'GET' && apiPath === 'projects/p-1/files') {
      return json({
        folderId: null, breadcrumbs: [], folders: [],
        files: [
          { id: 'f-1', kind: 'file', name: 'plan.pdf', mimeType: 'application/pdf', currentVersionId: 'v-1' },
          { id: 'f-2', kind: 'file', name: 'photo.png', mimeType: 'image/png', currentVersionId: 'v-2' },
          { id: 'f-3', kind: 'file', name: 'spec.docx', mimeType: DOCX, currentVersionId: 'v-3' },
        ],
      });
    }
    if (method === 'GET' && apiPath.startsWith('file-versions/')) {
      state.pageRequests.push(apiPath);
      return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    }
    if (method === 'GET' && apiPath === 'references/r-1') return json(ref);
    if (method === 'POST' && apiPath === 'messages/m-1/reference') {
      const body = req.postDataJSON();
      state.created.push(body);
      return json(reference({ id: 'r-1', can_edit: true, annotations: body.annotations, page_number: body.pageNumber }), 201);
    }
    if (method === 'GET') return json([]);
    return json({ ok: true });
  });
  return state;
}

test.use({ serviceWorkers: 'block' });

test('viewer shows the referenced page with the overlay in a right-side panel', async ({ page }) => {
  const state = await mockApi(page);
  await page.goto('/#/projects/p-1/references/r-1');
  const panel = page.locator('[data-testid="reference-viewer"]');
  await expect(panel).toBeVisible({ timeout: 10_000 });
  await expect(panel.locator('[data-testid="reference-page-image"]')).toBeVisible();
  await expect(page.locator('[data-testid="reference-overlay"] [data-annotation]')).toHaveCount(2);
  await expect(page.locator('[data-testid="reference-overlay"] [data-annotation="text"]')).toContainText('Check this dimension');
  expect(state.pageRequests).toContain('file-versions/v-1/pages/3');
  const box = await panel.boundingBox();
  const viewport = page.viewportSize()!;
  expect(Math.round(box!.x + box!.width)).toBe(viewport.width);
  expect(page.url()).not.toContain('/login');
});

test('viewer is read-only for non-authors', async ({ page }) => {
  await mockApi(page);
  await page.goto('/#/projects/p-1/references/r-1');
  await expect(page.locator('[data-testid="reference-page-image"]')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-testid="reference-edit"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="reference-delete"]')).toHaveCount(0);
});

test('viewer shows edit controls to the author', async ({ page }) => {
  await mockApi(page, reference({ can_edit: true }));
  await page.goto('/#/projects/p-1/references/r-1');
  await expect(page.locator('[data-testid="reference-edit"]')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-testid="reference-delete"]')).toBeVisible();
});

test('viewer reports a deleted file', async ({ page }) => {
  await mockApi(page, reference({ file_available: false, file_name: null }));
  await page.goto('/#/projects/p-1/references/r-1');
  await expect(page.locator('[data-testid="reference-viewer"]')).toContainText('This file is no longer available', { timeout: 10_000 });
});

test('editor only allows PDF and image files', async ({ page }) => {
  await mockApi(page);
  await page.goto('/#/projects/p-1/references/new?messageId=m-1');
  const picker = page.locator('[data-testid="reference-file-picker"]');
  await expect(picker).toContainText('Only PDF and image files can be referenced', { timeout: 10_000 });
  await expect(page.locator(`[data-testid="reference-file-option"][data-mime="${DOCX}"]`)).toBeDisabled();
  await expect(page.locator('[data-testid="reference-file-option"][data-mime="application/pdf"]')).toBeEnabled();
  await expect(page.locator('[data-testid="reference-file-option"][data-mime="image/png"]')).toBeEnabled();
  await expect(page.locator('[data-testid="reference-save"]')).toBeDisabled();
});

test('editor saves a text box and a freehand drawing on a chosen page', async ({ page }) => {
  const state = await mockApi(page);
  await page.goto('/#/projects/p-1/references/new?messageId=m-1');
  await page.locator('[data-testid="reference-file-option"][data-mime="application/pdf"]').click({ timeout: 10_000 });
  await page.locator('[data-testid="reference-page-next"]').click();
  await expect(page.locator('[data-testid="reference-page-number"]')).toContainText('Page 2');
  await expect(page.locator('[data-testid="reference-save"]')).toBeDisabled();

  const canvas = page.locator('[data-testid="reference-canvas"]');
  const box = (await canvas.boundingBox())!;

  await page.locator('[data-testid="reference-tool-text"]').click();
  await page.locator('[data-testid="reference-text-input"]').fill('Fix this');
  await page.mouse.click(box.x + box.width * 0.25, box.y + box.height * 0.25);

  await page.locator('[data-testid="reference-tool-draw"]').click();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.55, { steps: 5 });
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.6, { steps: 5 });
  await page.mouse.up();

  await expect(page.locator('[data-testid="reference-overlay"] [data-annotation]')).toHaveCount(2);
  await expect(page.locator('[data-testid="reference-save"]')).toBeEnabled();
  await page.locator('[data-testid="reference-save"]').click();

  await expect.poll(() => state.created.length).toBe(1);
  const body = state.created[0] as { fileId: string; pageNumber: number; annotations: Array<Record<string, unknown>> };
  expect(body.fileId).toBe('f-1');
  expect(body.pageNumber).toBe(2);
  expect(body.annotations.map((a) => a['type'])).toEqual(['text', 'stroke']);
  expect((body.annotations[1]['points'] as unknown[]).length).toBeGreaterThan(1);
  await expect(page).toHaveURL(/#\/projects\/p-1\/references\/r-1/);
});
