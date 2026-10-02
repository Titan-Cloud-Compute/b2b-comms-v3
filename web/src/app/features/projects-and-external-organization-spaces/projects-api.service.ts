import { Injectable, inject } from '@angular/core';
import { ApiClient } from '../../shared/api/api-client.service';
import {
  ApiClient as BaseApiClient,
  MockApiClient,
} from '../../shared/api/api-client';
import { ensureProjectsMock } from './projects-mocks';

// Contract types for the Projects and External Organization Spaces story
// (mirrors the card's endpoint contract; @contracts has no web-side slug yet).
export type OrganizationType = 'vendor' | 'customer' | 'client' | 'other';
export const ORGANIZATION_TYPES: OrganizationType[] = ['vendor', 'customer', 'client', 'other'];

export interface OrganizationRef {
  id: string;
  name: string;
  type: string;
}
export interface ProjectListItem {
  id: string;
  name: string;
  status: string;
  organization: OrganizationRef;
}
export interface ProjectListResponse {
  items: ProjectListItem[];
  page: number;
  total: number;
}
export interface ProjectMember {
  id: string;
  display_name: string;
  role: string;
}
export interface ProjectDetail extends ProjectListItem {
  default_channel_id?: string | null;
  members: ProjectMember[];
}
export interface InvitationResult {
  id: string;
  project_id?: string;
  email?: string;
  status: string;
  delivery: 'sent' | 'failed';
  expires_at: string;
}

/**
 * Thin API wrapper. In USE_MOCKS mode it routes through the app's
 * MockApiClient (registering this feature's handlers on demand); otherwise it
 * uses the real HTTP client (paths are relative to /api).
 */
@Injectable({ providedIn: 'root' })
export class ProjectsApiService {
  private http = inject(ApiClient);
  private base = inject(BaseApiClient, { optional: true });

  private call<T>(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown): Promise<T> {
    if (this.base instanceof MockApiClient) {
      ensureProjectsMock(this.base, method, `/api/${path}`);
      return this.base.request<T>(`/api/${path}`, { method, body });
    }
    if (method === 'GET') return this.http.get<T>(path);
    if (method === 'PATCH') return this.http.patch<T>(path, body);
    return this.http.post<T>(path, body);
  }

  list(): Promise<ProjectListResponse> {
    return this.call('GET', 'projects');
  }
  get(id: string): Promise<ProjectDetail> {
    return this.call('GET', `projects/${encodeURIComponent(id)}`);
  }
  create(body: { organization_name: string; organization_type: OrganizationType }): Promise<ProjectDetail> {
    return this.call('POST', 'projects', body);
  }
  archive(id: string): Promise<{ id: string; status: string }> {
    return this.call('POST', `projects/${encodeURIComponent(id)}/archive`);
  }
  invite(id: string, email: string): Promise<InvitationResult> {
    return this.call('POST', `projects/${encodeURIComponent(id)}/invitations`, { email });
  }
  resend(invitationId: string): Promise<InvitationResult> {
    return this.call('POST', `invitations/${encodeURIComponent(invitationId)}/resend`);
  }
}
