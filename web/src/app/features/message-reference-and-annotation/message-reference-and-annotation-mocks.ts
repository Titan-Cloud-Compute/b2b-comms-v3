import { MockApiClient } from '../../shared/api/api-client';
import type { Annotations, PickerFile, ReferenceView } from './message-reference-and-annotation-api.service';

/* In-memory fixtures for USE_MOCKS mode. */
interface MockRef extends Omit<ReferenceView, 'can_edit'> { project_id: string }

const sample: Annotations = {
  text_boxes: [{ x: 0.12, y: 0.18, text: 'Check this beam size' }],
  drawings: [{ points: [{ x: 0.1, y: 0.4 }, { x: 0.3, y: 0.45 }, { x: 0.5, y: 0.4 }], color: '#d33', width: 3 }],
};

const refs: MockRef[] = [
  {
    id: 'r1', project_id: 'p1', message_id: 'm0', file_version_id: 'fv1', page_number: 3,
    annotations: sample, author_id: 'u-author', file_available: true, mime_type: 'application/pdf',
    updated_at: new Date().toISOString(),
  },
];

/** Picker fixtures (the File Explorer mock has no non-referenceable files). */
export const MOCK_PICKER_FILES: PickerFile[] = [
  { id: 'fi1', name: 'brief.pdf', mime_type: 'application/pdf', version_id: 'fv1' },
  { id: 'fi2', name: 'site-photo.png', mime_type: 'image/png', version_id: 'fv2' },
  { id: 'fi3', name: 'minutes.docx', mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', version_id: 'fv3' },
];

const MOCK_USER = 'u-me';
let seq = 2;

const fail = (status: number, message: string) => Object.assign(new Error(message), { status });

function valid(a: Annotations | undefined): boolean {
  return !!a && ((a.text_boxes?.length ?? 0) > 0 || (a.drawings?.length ?? 0) > 0);
}

function handlerFor(method: string, path: string): ((body?: unknown) => Promise<unknown>) | null {
  const [clean] = path.replace(/^\/api\//, '').split('?');
  const parts = clean.split('/');
  if (parts[0] === 'messages' && parts[2] === 'reference' && parts.length === 3 && method === 'POST') {
    return async (body) => {
      const b = (body ?? {}) as { file_version_id?: string; page_number?: number; annotations?: Annotations };
      const f = MOCK_PICKER_FILES.find((x) => x.version_id === b.file_version_id);
      if (!f) throw fail(400, 'file: does not exist');
      if (!/^image\/|^application\/pdf$/.test(f.mime_type)) throw fail(400, 'Only PDF and image files can be referenced');
      if (!valid(b.annotations)) throw fail(400, 'annotations: add at least one text box or drawing');
      const r: MockRef = {
        id: `r${seq++}`, project_id: 'p1', message_id: parts[1], file_version_id: f.version_id ?? '', page_number: b.page_number ?? 1,
        annotations: b.annotations!, author_id: MOCK_USER, file_available: true, mime_type: f.mime_type, updated_at: new Date().toISOString(),
      };
      refs.push(r);
      const { project_id: _p, file_available: _f, mime_type: _m, updated_at: _u, ...created } = r;
      return created;
    };
  }
  if (parts[0] === 'references' && parts.length === 2) {
    const find = () => {
      const r = refs.find((x) => x.id === parts[1]);
      if (!r) throw fail(404, 'Reference does not exist');
      return r;
    };
    if (method === 'GET') {
      return async () => {
        const { project_id: _p, ...r } = find();
        return { ...r, can_edit: r.author_id === MOCK_USER };
      };
    }
    if (method === 'PUT') {
      return async (body) => {
        const r = find();
        if (r.author_id !== MOCK_USER) throw fail(403, 'Forbidden');
        const b = (body ?? {}) as { page_number?: number; annotations?: Annotations };
        if (!valid(b.annotations)) throw fail(400, 'annotations: add at least one text box or drawing');
        r.annotations = b.annotations!;
        r.page_number = b.page_number ?? r.page_number;
        r.updated_at = new Date().toISOString();
        return { id: r.id, page_number: r.page_number, annotations: r.annotations, updated_at: r.updated_at };
      };
    }
    if (method === 'DELETE') {
      return async () => {
        const r = find();
        if (r.author_id !== MOCK_USER) throw fail(403, 'Forbidden');
        refs.splice(refs.indexOf(r), 1);
        return { id: r.id, deleted: true };
      };
    }
  }
  return null;
}

/** Register this feature's mock for `method path` if it is one of ours. */
export function ensureReferenceMock(client: MockApiClient, method: string, path: string): void {
  const handler = handlerFor(method, path);
  if (handler) client.registerMock(method, path, handler);
}
