/**
 * Hermetic spec for the Message Reference and Annotation story.
 * Every /api/** call is mocked via page.route() — nothing reaches the network.
 */
import { test, expect, type Page } from '@playwright/test';

const PROJECT_ID = 'p1';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

interface Ref {
  id: string; message_id: string; file_version_id: string; page_number: number;
  annotations: { text_boxes: { x: number; y: number; text: string }[]; drawings: { points: { x: number; y: number }[] }[] };
  author_id: string; file_available: boolean; mime_type: string;
}
interface State { me: string; refs: Ref[]; posts: unknown[]; puts: unknown[] }

async function mockApi(page: Page, me = 'u-viewer'): Promise<State> {
  const state: State = {
    me,
    refs: [{
      id: 'r1', message_id: 'm0', file_version_id: 'fv1', page_number: 3,
      annotations: {
        text_boxes: [{ x: 0.2, y: 0.2, text: 'Check this beam' }],
        drawings: [{ points: [{ x: 0.1, y: 0.5 }, { x: 0.4, y: 0.6 }] }],
      },
      author_id: 'u-author', file_available: true, mime_type: 'application/pdf',
    }],
    posts: [],
    puts: [],
  };

  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const method = req.method().toUpperCase();
    const apiPath = new URL(req.url()).pathname.replace(/^.*\/api\//, '').replace(/^\//, '');
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (method === 'GET' && apiPath === 'users/me') return json({ id: state.me, email: 'member@example.com', role: 'USER' });
    if (/^file-versions\/[^/]+\/pages\/\d+$/.test(apiPath)) return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });

    if (method === 'GET' && apiPath === `projects/${PROJECT_ID}/files`) {
      return json({
        folder: { id: null, name: 'Files', breadcrumbs: [] },
        folders: [],
        files: [
          { id: 'f-pdf', name: 'plans.pdf', mime_type: 'application/pdf' },
          { id: 'f-png', name: 'photo.png', mime_type: 'image/png' },
          { id: 'f-zip', name: 'bundle.zip', mime_type: 'application/zip' },
        ],
      });
    }
    const versions = /^files\/([^/]+)\/versions$/.exec(apiPath);
    if (versions) return json({ items: [{ id: `fv-${versions[1]}`, version_number: 1 }] });

    const post = /^messages\/([^/]+)\/reference$/.exec(apiPath);
    if (post && method === 'POST') {
      const b = req.postDataJSON();
      state.posts.push(b);
      const r: Ref = { id: 'r9', message_id: post[1], author_id: state.me, file_available: true, mime_type: 'application/pdf', ...b };
      state.refs.push(r);
      return json({ id: r.id, message_id: r.message_id, file_version_id: r.file_version_id, page_number: r.page_number, annotations: r.annotations, author_id: r.author_id }, 201);
    }

    const one = /^references\/([^/]+)$/.exec(apiPath);
    if (one) {
      const r = state.refs.find((x) => x.id === one[1]);
      if (!r) return json({ message: 'Reference does not exist' }, 404);
      if (method === 'GET') return json({ ...r, can_edit: r.author_id === state.me });
      if (r.author_id !== state.me) return json({ message: 'Forbidden' }, 403);
      if (method === 'PUT') {
        const b = req.postDataJSON();
        state.puts.push(b);
        Object.assign(r, b);
        return json({ id: r.id, page_number: r.page_number, annotations: r.annotations, updated_at: new Date().toISOString() });
      }
      if (method === 'DELETE') return json({ id: r.id, deleted: true });
    }

    if (method === 'GET') return json([]);
    return json({ ok: true });
  });
  return state;
}

test.use({ serviceWorkers: 'block' });

test('viewer: panel shows the referenced page with the author marks and no edit controls', async ({ page }) => {
  await mockApi(page);
  await page.goto(`/#/projects/${PROJECT_ID}/references/r1`);
  const panel = page.getByTestId('reference-panel');
  await expect(panel).toBeVisible({ timeout: 10_000 });
  await expect(panel.locator('img[data-testid="reference-page"]')).toHaveAttribute('src', /\/api\/file-versions\/fv1\/pages\/3$/);
  await expect(page.getByTestId('reference-overlay').getByTestId('overlay-textbox')).toHaveText('Check this beam');
  await expect(page.getByTestId('overlay-drawing')).toHaveCount(1);
  await expect(page.getByTestId('reference-edit')).toHaveCount(0);
  await expect(page.getByTestId('reference-delete')).toHaveCount(0);
});

test('viewer: the author gets edit controls', async ({ page }) => {
  await mockApi(page, 'u-author');
  await page.goto(`/#/projects/${PROJECT_ID}/references/r1`);
  await expect(page.getByTestId('reference-edit')).toBeVisible({ timeout: 10_000 });
});

test('viewer: a deleted file shows the unavailable message', async ({ page }) => {
  const state = await mockApi(page);
  state.refs[0].file_available = false;
  await page.goto(`/#/projects/${PROJECT_ID}/references/r1`);
  await expect(page.getByTestId('reference-panel')).toContainText('This file is no longer available', { timeout: 10_000 });
  await expect(page.getByTestId('reference-page')).toHaveCount(0);
});

test('editor: non-PDF/image files are not selectable and the rule is shown', async ({ page }) => {
  await mockApi(page);
  await page.goto(`/#/projects/${PROJECT_ID}/references/new?messageId=m1`);
  await expect(page.getByTestId('reference-editor')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Only PDF and image files can be referenced').first()).toBeVisible();
  await expect(page.locator('[data-testid="file-option"][aria-disabled="true"]')).toHaveText('bundle.zip');
  await expect(page.getByTestId('draw-surface')).toBeVisible();
});

test('editor: empty save is rejected without calling the API', async ({ page }) => {
  const state = await mockApi(page, 'u-author');
  await page.goto(`/#/projects/${PROJECT_ID}/references/new?messageId=m1`);
  await page.getByTestId('file-option').filter({ hasText: 'plans.pdf' }).click();
  await page.getByTestId('reference-save').click();
  await expect(page.getByTestId('reference-editor-error')).toContainText('at least one text box or drawing');
  expect(state.posts).toHaveLength(0);
});

test('editor: picks a PDF page, adds a text box and a drawing, saves and opens the viewer', async ({ page }) => {
  const state = await mockApi(page, 'u-author');
  await page.goto(`/#/projects/${PROJECT_ID}/references/new?messageId=m1`);
  await page.getByTestId('file-option').filter({ hasText: 'plans.pdf' }).click();
  await page.getByTestId('page-next').click();
  await page.getByTestId('page-next').click();
  await expect(page.getByTestId('editor-page')).toHaveAttribute('src', /\/pages\/3$/);

  const box = (await page.getByTestId('draw-surface').boundingBox())!;
  await page.getByTestId('tool-text').click();
  await page.mouse.click(box.x + box.width * 0.25, box.y + box.height * 0.25);
  await page.getByTestId('editor-textbox').fill('Check this beam');

  await page.getByTestId('tool-draw').click();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByTestId('editor-drawing')).toHaveCount(1);

  await page.getByTestId('reference-save').click();
  await expect(page).toHaveURL(/references\/r9$/);
  const body = state.posts[0] as { file_version_id: string; page_number: number; annotations: { text_boxes: { text: string }[]; drawings: unknown[] } };
  expect(body.file_version_id).toBe('fv-f-pdf');
  expect(body.page_number).toBe(3);
  expect(body.annotations.text_boxes[0].text).toBe('Check this beam');
  expect(body.annotations.drawings).toHaveLength(1);
  await expect(page.getByTestId('reference-edit')).toBeVisible();
});

test('editor: the author edits an existing reference with PUT', async ({ page }) => {
  const state = await mockApi(page, 'u-author');
  await page.goto(`/#/projects/${PROJECT_ID}/references/new?messageId=m0&referenceId=r1`);
  await expect(page.getByTestId('editor-textbox')).toHaveValue('Check this beam', { timeout: 10_000 });
  await page.getByTestId('editor-textbox').fill('Use the 300mm beam');
  await page.getByTestId('reference-save').click();
  await expect(page).toHaveURL(/references\/r1$/);
  expect((state.puts[0] as { annotations: { text_boxes: { text: string }[] } }).annotations.text_boxes[0].text).toBe('Use the 300mm beam');
});
