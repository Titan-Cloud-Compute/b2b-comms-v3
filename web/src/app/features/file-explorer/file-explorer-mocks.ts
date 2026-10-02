import { MockApiClient } from '../../shared/api/api-client';

/* In-memory fixtures for USE_MOCKS mode. */
interface MockFolder { id: string; name: string; parent_id: string | null }
interface MockFile {
  id: string; name: string; mime_type: string; size_bytes: number; uploaded_by: string;
  uploaded_at: string; version_number: number; folder_id: string | null;
}

const folders: MockFolder[] = [{ id: 'fo1', name: 'Contracts', parent_id: null }];
const files: MockFile[] = [
  { id: 'fi1', name: 'brief.pdf', mime_type: 'application/pdf', size_bytes: 20480, uploaded_by: 'u-manager',
    uploaded_at: new Date().toISOString(), version_number: 1, folder_id: null },
];
let seq = 10;

function handlerFor(method: string, path: string): ((body?: unknown) => Promise<unknown>) | null {
  const [clean, query = ''] = path.replace(/^\/api\//, '').split('?');
  const parts = clean.split('/');
  const params = new URLSearchParams(query);
  if (parts[0] === 'projects' && parts[2] === 'files' && method === 'GET') {
    return async () => {
      const folderId = params.get('folder_id') || null;
      const q = (params.get('q') ?? '').toLowerCase();
      const current = folders.find((f) => f.id === folderId) ?? null;
      const hit = (n: string) => !q || n.toLowerCase().includes(q);
      return {
        folder: {
          id: current?.id ?? null,
          name: current?.name ?? 'Files',
          breadcrumbs: [{ id: null, name: 'Files' }, ...(current ? [{ id: current.id, name: current.name }] : [])],
        },
        folders: folders.filter((f) => (q || f.parent_id === folderId) && hit(f.name)),
        files: files.filter((f) => (q || f.folder_id === folderId) && hit(f.name)),
      };
    };
  }
  if (parts[0] === 'projects' && parts[2] === 'files' && method === 'POST') {
    return async () => ({ items: [] });
  }
  if (parts[0] === 'projects' && parts[2] === 'folders' && method === 'POST') {
    return async (body) => {
      const b = (body ?? {}) as { name?: string; parent_id?: string | null };
      const f = { id: `fo${seq++}`, name: b.name ?? 'Folder', parent_id: b.parent_id ?? null };
      folders.push(f);
      return f;
    };
  }
  if (parts[0] === 'files' && parts[2] === 'versions') {
    return async () => ({ items: files.filter((f) => f.id === parts[1]).map((f) => ({ ...f, id: `v-${f.id}` })) });
  }
  if (parts[0] === 'files' && parts[2] === 'download') {
    return async () => ({ url: 'about:blank', expires_in: 300 });
  }
  if ((parts[0] === 'files' || parts[0] === 'folders') && parts.length === 2) {
    const list: { id: string; name: string }[] = parts[0] === 'files' ? files : folders;
    if (method === 'DELETE') {
      return async () => {
        const i = list.findIndex((x) => x.id === parts[1]);
        if (i >= 0) list.splice(i, 1);
        return null;
      };
    }
    if (method === 'PATCH') {
      return async (body) => {
        const row = list.find((x) => x.id === parts[1]);
        if (row) Object.assign(row, body as object);
        return row;
      };
    }
  }
  return null;
}

/** Register this feature's mock for `method path` if not already present. */
export function ensureFileExplorerMock(client: MockApiClient, method: string, path: string): void {
  const handler = handlerFor(method, path);
  if (handler) client.registerMock(method, path, handler);
}
