import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../shared/auth.service';
import { ProjectListItem, ProjectsApiService } from './projects-api.service';
import { projectErrorMessage } from './project-errors';

@Component({
  selector: 'app-project-list',
  standalone: true,
  imports: [RouterLink],
  template: `
    <section class="projects" data-testid="project-list-page" data-placeholder>
      <header class="projects-header">
        <h1>Projects</h1>
        @if (canCreate()) {
          <a routerLink="/projects/new" class="btn-new" data-testid="new-project-link">New project</a>
        }
      </header>

      @if (loading()) {
        <p>Loading projects...</p>
      } @else if (error()) {
        <p class="error" role="alert">{{ error() }}</p>
      } @else if (projects().length === 0) {
        <p data-testid="project-list-empty">No projects yet.</p>
      } @else {
        <ul data-testid="project-list">
          @for (p of projects(); track p.id) {
            <li data-testid="project-row">
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
    '.projects-header { display: flex; align-items: center; gap: 1rem; margin-bottom: 1.5rem; }',
    '.projects-header h1 { margin: 0; flex: 1; }',
    '.btn-new { padding: 0.5rem 1rem; background: #4f46e5; color: #fff; border-radius: 0.375rem; text-decoration: none; font-size: 0.875rem; }',
    '.btn-new:hover { background: #4338ca; }',
    'ul { list-style: none; padding: 0; }',
    'li { display: flex; gap: 0.75rem; padding: 0.5rem 0; border-bottom: 1px solid #e5e7eb; }',
    '.type { color: #6b7280; }',
    '.error { color: #b91c1c; }',
  ],
})
export class ProjectListComponent implements OnInit {
  private api = inject(ProjectsApiService);
  private auth = inject(AuthService);

  readonly projects = signal<ProjectListItem[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

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
}
