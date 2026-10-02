/**
 * Story: Message Reference and Annotation — references CRUD over HTTP
 * (real Nest app + supertest, in-memory DB).
 */
import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { as, makeApp, makeDb } from './fake-db.spec-helper';

describe('References HTTP', () => {
  let app: INestApplication;
  let db: ReturnType<typeof makeDb>;

  beforeEach(async () => {
    db = makeDb();
    app = await makeApp(db);
  });
  afterEach(async () => {
    await app.close();
  });

  const annotations = {
    text_boxes: [{ x: 0.2, y: 0.3, text: 'Check this beam' }],
    drawings: [{ points: [{ x: 0.1, y: 0.1 }, { x: 0.4, y: 0.4 }], color: '#d00', width: 2 }],
  };
  const create = (user = 'author', body: Record<string, unknown> = { file_id: 'f-pdf', page_number: 3, annotations }, msg = 'm1') =>
    request(app.getHttpServer()).post(`/api/messages/${msg}/reference`).set(as(user)).send(body);

  it('creates a reference (201) pinned to the current file version', async () => {
    const res = await create();
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ message_id: 'm1', file_version_id: 'fv-pdf-1', page_number: 3, author_id: 'author', annotations });
    expect(db.tx.references.rows).toHaveLength(1);
  });

  it('another member views it (200) read-only; PUT/DELETE are 403', async () => {
    const { body } = await create();
    const view = await request(app.getHttpServer()).get(`/api/references/${body.id}`).set(as('viewer'));
    expect(view.status).toBe(200);
    expect(view.body).toMatchObject({ id: body.id, file_available: true, can_edit: false, page_number: 3, file_version_id: 'fv-pdf-1' });
    const put = await request(app.getHttpServer()).put(`/api/references/${body.id}`).set(as('viewer')).send({ annotations });
    expect(put.status).toBe(403);
    const del = await request(app.getHttpServer()).delete(`/api/references/${body.id}`).set(as('viewer'));
    expect(del.status).toBe(403);
    expect(db.tx.references.rows).toHaveLength(1);
  });

  it('the author sees can_edit and can update (200) and delete', async () => {
    const { body } = await create();
    const view = await request(app.getHttpServer()).get(`/api/references/${body.id}`).set(as('author'));
    expect(view.body.can_edit).toBe(true);
    const next = { text_boxes: [{ x: 0.5, y: 0.5, text: 'Updated' }], drawings: [] };
    const put = await request(app.getHttpServer()).put(`/api/references/${body.id}`).set(as('author')).send({ page_number: 4, annotations: next });
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({ id: body.id, page_number: 4, annotations: next });
    expect(put.body.updated_at).toBeTruthy();
    const again = await request(app.getHttpServer()).get(`/api/references/${body.id}`).set(as('viewer'));
    expect(again.body.annotations).toEqual(next);
    const del = await request(app.getHttpServer()).delete(`/api/references/${body.id}`).set(as('author'));
    expect(del.status).toBe(200);
    expect(db.tx.references.rows).toHaveLength(0);
  });

  it('rejects unsupported files, empty and malformed/oversized payloads with 400', async () => {
    expect((await create('author', { file_id: 'f-zip', page_number: 1, annotations })).status).toBe(400);
    expect((await create('author', { file_id: 'f-pdf', page_number: 1, annotations: { text_boxes: [], drawings: [] } })).status).toBe(400);
    expect((await create('author', { file_id: 'f-pdf', page_number: 1, annotations: { text_boxes: 'nope' } })).status).toBe(400);
    expect((await create('author', { file_id: 'f-pdf', page_number: 0, annotations })).status).toBe(400);
    const huge = { text_boxes: Array.from({ length: 130 }, () => ({ x: 0, y: 0, text: 'x'.repeat(9_000) })) };
    expect((await create('author', { file_id: 'f-pdf', page_number: 1, annotations: huge })).status).toBe(400);
    expect(db.tx.references.rows).toHaveLength(0);

    const { body } = await create();
    const bad = await request(app.getHttpServer()).put(`/api/references/${body.id}`).set(as('author')).send({ annotations: huge });
    expect(bad.status).toBe(400);
    expect(db.tx.references.rows[0].annotations).toEqual(annotations);
  });

  it('keeps file_version_id when a newer version is uploaded', async () => {
    const { body } = await create();
    db.tx.file_versions.rows.push({ id: 'fv-pdf-2', file_id: 'f-pdf', version_number: 2, storage_key: 'k/pdf2' });
    db.tx.files.rows[0].current_version_id = 'fv-pdf-2';
    const view = await request(app.getHttpServer()).get(`/api/references/${body.id}`).set(as('viewer'));
    expect(view.status).toBe(200);
    expect(view.body.file_version_id).toBe('fv-pdf-1');
    expect(db.tx.references.rows[0].file_version_id).toBe('fv-pdf-1');
  });

  it('reports file_available false when the file was deleted', async () => {
    const { body } = await create();
    db.tx.files.rows[0].deleted_at = new Date();
    const view = await request(app.getHttpServer()).get(`/api/references/${body.id}`).set(as('viewer'));
    expect(view.status).toBe(200);
    expect(view.body.file_available).toBe(false);
  });

  it('non-members get 403 and unauthenticated callers 401', async () => {
    const { body } = await create();
    expect((await request(app.getHttpServer()).get(`/api/references/${body.id}`).set(as('outsider'))).status).toBe(403);
    expect((await create('outsider', { file_id: 'f-pdf', page_number: 1, annotations }, 'm2')).status).toBe(403);
    expect((await request(app.getHttpServer()).get(`/api/references/${body.id}`)).status).toBe(401);
    expect((await request(app.getHttpServer()).post('/api/messages/m2/reference').send({ file_id: 'f-pdf', annotations })).status).toBe(401);
  });

  it('only the message author can attach a reference, once', async () => {
    expect((await create('viewer')).status).toBe(403);
    expect((await create()).status).toBe(201);
    expect((await create()).status).toBe(409);
  });
});
