import { Injectable, inject } from '@angular/core';
import { ApiClient } from '../../shared/api/api-client.service';

export type OrganizationType = 'vendor' | 'customer' | 'client' | 'other';
export const ORGANIZATION_TYPES: readonly OrganizationType[] = ['vendor', 'customer', 'client', 'other'];

export interface Project {
  id: string;
  name: string;
  status: string;
  organizationId: string;
  organizationName: string;
  organizationType: string;
  createdAt: string;
}

export interface ProjectPage {
  items: Project[];
  total: number;
  page: number;
  pageSize: number;
}

@Injectable({ providedIn: 'root' })
export class ProjectsApi {
  private api = inject(ApiClient);

  list(page = 1, pageSize = 25): Promise<ProjectPage> {
    return this.api.get<ProjectPage>('projects', { params: { page, pageSize } });
  }

  get(id: string): Promise<Project> {
    return this.api.get<Project>(`projects/${encodeURIComponent(id)}`);
  }

  create(organizationName: string, organizationType: OrganizationType): Promise<Project> {
    return this.api.post<Project>('projects', { organizationName, organizationType });
  }
}
