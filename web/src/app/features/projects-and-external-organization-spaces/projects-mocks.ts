import { MockApiClient } from '../../shared/api/api-client';

/* In-memory fixtures for USE_MOCKS mode. */
interface MockProject {
  id: string;
  name: string;
  status: string;
  organization: { id: string; name: string; type: string };
  default_channel_id: string;
  members: { id: string; display_name: string; role: string }[];
}

const projects: MockProject[] = [
  {
    id: 'p1',
    name: 'Globex',
    status: 'active',
    organization: { id: 'org-globex', name: 'Globex', type: 'customer' },
    default_channel_id: 'ch-p1',
    members: [{ id: 'u-manager', display_name: 'Demo Manager', role: 'MANAGER' }],
  },
  {
    id: 'p2',
    name: 'Initech',
    status: 'active',
    organization: { id: 'org-initech', name: 'Initech', type: 'vendor' },
    default_channel_id: 'ch-p2',
    members: [],
  },
];
let seq = 3;

function handlerFor(method: string, path: string): ((body?: unknown) => Promise<unknown>) | null {
  const clean = path.split('?')[0].replace(/^\/api\//, '');
  const parts = clean.split('/');
  if (method === 'GET' && clean === 'projects') {
    return async () => {
      const items = projects.filter((p) => p.status !== 'archived').map(({ id, name, status, organization }) => ({ id, name, status, organization }));
      return { items, page: 1, total: items.length };
    };
  }
  if (method === 'POST' && clean === 'projects') {
    return async (body) => {
      const b = (body ?? {}) as { organization_name?: string; organization_type?: string };
      const name = (b.organization_name ?? '').trim();
      if (!name) throw new Error('organization_name: must not be blank');
      const id = `p${seq++}`;
      const project: MockProject = {
        id,
        name,
        status: 'active',
        organization: { id: `org-${id}`, name, type: b.organization_type ?? 'other' },
        default_channel_id: `ch-${id}`,
        members: [],
      };
      projects.push(project);
      return project;
    };
  }
  if (parts[0] === 'projects' && parts.length >= 2) {
    const project = () => projects.find((p) => p.id === decodeURIComponent(parts[1]));
    if (method === 'GET' && parts.length === 2) {
      return async () => {
        const p = project();
        if (!p) throw new Error('Project does not exist');
        return p;
      };
    }
    if (method === 'POST' && parts[2] === 'archive') {
      return async () => {
        const p = project();
        if (p) p.status = 'archived';
        return { id: parts[1], status: 'archived' };
      };
    }
    if (method === 'POST' && parts[2] === 'invitations') {
      return async (body) => ({
        id: `inv-${seq++}`,
        project_id: parts[1],
        email: (body as { email?: string } | undefined)?.email ?? '',
        status: 'pending',
        delivery: 'sent',
        expires_at: new Date(Date.now() + 7 * 864e5).toISOString(),
      });
    }
  }
  if (method === 'POST' && parts[0] === 'invitations' && parts[2] === 'resend') {
    return async () => ({
      id: parts[1],
      status: 'pending',
      delivery: 'sent',
      expires_at: new Date(Date.now() + 7 * 864e5).toISOString(),
    });
  }
  return null;
}

/** Register this feature's mock for `method path` if not already present. */
export function ensureProjectsMock(client: MockApiClient, method: string, path: string): void {
  const handler = handlerFor(method, path);
  if (handler) client.registerMock(method, path, handler);
}
