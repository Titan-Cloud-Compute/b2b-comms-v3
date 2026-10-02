/**
 * Story: Message Reference and Annotation — GET /api/file-versions/:id/pages/:page.
 */
import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { as, makeApp, makeDb } from './fake-db.spec-helper';

describe('File version pages HTTP', () => {
  let app: INestApplication;
  let db: ReturnType<typeof makeDb>;

  beforeEach(async () => {
    db = makeDb();
    app = await makeApp(db);
  });
  afterEach(async () => {
    await app.close();
  });

  const get = (path: string, user?: string) => {
    const r = request(app.getHttpServer()).get(path);
    return user ? r.set(as(user)) : r;
  };

  it('serves an image page with its content type', async () => {
    const res = await get('/api/file-versions/fv-png-1/pages/1', 'viewer');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^image\/png/);
    expect(Buffer.from(res.body).equals(db.objects['k/png1'])).toBe(true);
  });

  it('serves a PDF page', async () => {
    const res = await get('/api/file-versions/fv-pdf-1/pages/3', 'viewer');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/pdf/);
  });

  it('serves the original version after a newer one is uploaded', async () => {
    db.tx.file_versions.rows.push({ id: 'fv-png-2', file_id: 'f-png', version_number: 2, storage_key: 'k/png2' });
    db.tx.files.rows[1].current_version_id = 'fv-png-2';
    expect((await get('/api/file-versions/fv-png-1/pages/1', 'viewer')).status).toBe(200);
  });

  it('rejects bad pages, unsupported files and missing versions', async () => {
    expect((await get('/api/file-versions/fv-png-1/pages/0', 'viewer')).status).toBe(400);
    expect((await get('/api/file-versions/fv-png-1/pages/2', 'viewer')).status).toBe(404);
    expect((await get('/api/file-versions/fv-zip-1/pages/1', 'viewer')).status).toBe(400);
    expect((await get('/api/file-versions/nope/pages/1', 'viewer')).status).toBe(404);
  });

  it('returns 404 when the file was deleted', async () => {
    db.tx.files.rows[1].deleted_at = new Date();
    expect((await get('/api/file-versions/fv-png-1/pages/1', 'viewer')).status).toBe(404);
  });

  it('non-members get 403 and unauthenticated callers 401', async () => {
    expect((await get('/api/file-versions/fv-png-1/pages/1', 'outsider')).status).toBe(403);
    expect((await get('/api/file-versions/fv-png-1/pages/1')).status).toBe(401);
  });
});
