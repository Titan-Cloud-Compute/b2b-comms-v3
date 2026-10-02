import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../shared/auth.service';
import {
  ORGANIZATION_TYPES,
  OrganizationType,
  ProjectListItem,
  ProjectsApiService,
} from './projects-api.service';
import { projectErrorMessage } from './project-errors';

@Component({
  selector: 'app-project-list',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <section class="projects" data-testid="project-list-page">
      <h1>Projects</h1>

      @if (canCreate()) {
        <form class="create" data-testid="create-project-form" (ngSubmit)="create()">
          <label>
            External organization name
            <input name="orgName" [(ngModel)]="orgName" data-testid="create-project-name" />
          </label>
          <label>
            Type
            <select name="orgType" [(ngModel)]="orgType" data-testid="create-project-type">
              @for (t of types; track t) {
                <option [value]="t">{{ t }}</option>
              }
            </select>
          </label>
          <button type="submit" [disabled]="saving()">Create project</button>
          @if (createError()) {
            <p class="error" role="alert">{{ createError() }}</p>
          }
        </form>
      }

      @if (loading()) {
        <p>Loading projects...</p>
      } @else if (error()) {
        <p class="error" role="alert">{{ error() }}</p>
      } @else if (projects().length === 0) {
        <p data-testid="project-list-empty">No projects yet.</p>
      } @else {
        <ul data-testid="project-list">
          @for (p of projects(); track p.id) {
            <li data-testid="project-list-item">
              <a [routerLink]="['/projects', p.id]">{{ p.organization.name || p.name }}</a>
              <span class="type">{{ p.organization.type }}</span>
            </li>
          }
        </ul>
      }
    </section>
  `,
  styles: [
    '.projects { padding: 1.5rem; max-width: 48rem; }',
    '.create { display: flex; gap: 0.75rem; flex-wrap: wrap; align-items: flex-end; margin-bottom: 1.5rem; }',
    '.create label { display: flex; flex-direction: column; gap: 0.25rem; }',
    'ul { list-style: none; padding: 0; }',
    'li { display: flex; gap: 0.75rem; padding: 0.5rem 0; border-bottom: 1px solid #e5e7eb; }',
    '.type { color: #6b7280; }',
    '.error { color: #b91c1c; }',
  ],
})
export class ProjectListComponent implements OnInit {
  private api = inject(ProjectsApiService);
  private auth = inject(AuthService);
  private router = inject(Router);

  readonly types = ORGANIZATION_TYPES;
  readonly projects = signal<ProjectListItem[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly saving = signal(false);
  readonly createError = signal<string | null>(null);

  orgName = '';
  orgType: OrganizationType = 'vendor';

  readonly canCreate = computed(() => {
    const role = this.auth.user()?.role;
    return role === 'MANAGER' || role === 'ADMIN' || role === 'SUPER_ADMIN';
  });

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const res = await this.api.list();
      this.projects.set(res?.items ?? []);
    } catch (err) {
      this.error.set(projectErrorMessage(err, 'Could not load projects.'));
    } finally {
      this.loading.set(false);
    }
  }

  async create(): Promise<void> {
    const name = this.orgName.trim();
    if (!name) {
      this.createError.set('Organization name is required.');
      return;
    }
    this.saving.set(true);
    this.createError.set(null);
    try {
      const created = await this.api.create({ organization_name: name, organization_type: this.orgType });
      this.orgName = '';
      await this.router.navigate(['/projects', created.id]);
    } catch (err) {
      this.createError.set(projectErrorMessage(err, 'Could not create project.'));
    } finally {
      this.saving.set(false);
    }
  }
}
