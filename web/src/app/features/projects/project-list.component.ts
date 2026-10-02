import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../shared/auth.service';
import { Project, ProjectsApi } from './projects.api';

@Component({
  selector: 'app-project-list',
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="projects-page">
      <header class="page-header">
        <h1 data-testid="projects-heading">Projects</h1>
        @if (canCreate()) {
          <a class="btn-primary" routerLink="/projects/new" data-testid="new-project">New project</a>
        }
      </header>

      <section data-testid="project-list" class="project-list" [attr.aria-busy]="loading()">
        @if (loading()) {
          <p class="muted">Loading projects…</p>
        } @else if (error()) {
          <p class="muted" role="alert">{{ error() }}</p>
        } @else if (projects().length === 0) {
          <p class="muted" data-testid="projects-empty">No projects yet.</p>
        } @else {
          <ul>
            @for (p of projects(); track p.id) {
              <li data-testid="project-item">
                <a [routerLink]="['/projects', p.id]" data-testid="project-link">{{ p.organizationName || p.name }}</a>
                <span class="muted">{{ p.organizationType }}</span>
              </li>
            }
          </ul>
          @if (total() > pageSize) {
            <nav class="pager">
              <button type="button" [disabled]="page() <= 1" (click)="go(page() - 1)">Previous</button>
              <span>Page {{ page() }}</span>
              <button type="button" [disabled]="page() * pageSize >= total()" (click)="go(page() + 1)">Next</button>
            </nav>
          }
        }
      </section>
    </div>
  `,
  styles: [`
    .projects-page { max-width: 800px; margin: 0 auto; padding: 2rem 1rem; }
    .page-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.5rem; }
    ul { list-style: none; padding: 0; margin: 0; }
    li { display: flex; justify-content: space-between; padding: 0.75rem 0; border-bottom: 1px solid var(--color-border); }
    .muted { opacity: 0.7; }
    .pager { display: flex; gap: 1rem; align-items: center; margin-top: 1rem; }
  `],
})
export class ProjectListComponent implements OnInit {
  private api = inject(ProjectsApi);
  private auth = inject(AuthService);

  readonly pageSize = 25;
  projects = signal<Project[]>([]);
  total = signal(0);
  page = signal(1);
  loading = signal(true);
  error = signal<string | null>(null);

  canCreate = computed(() => {
    const role = this.auth.user()?.role;
    return role === 'MANAGER' || role === 'ADMIN' || role === 'SUPER_ADMIN';
  });

  ngOnInit(): void {
    void this.go(1);
  }

  async go(page: number): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const res = await this.api.list(page, this.pageSize);
      this.projects.set(Array.isArray(res?.items) ? res.items : []);
      this.total.set(typeof res?.total === 'number' ? res.total : 0);
      this.page.set(page);
    } catch {
      this.projects.set([]);
      this.error.set('Could not load projects.');
    } finally {
      this.loading.set(false);
    }
  }
}
