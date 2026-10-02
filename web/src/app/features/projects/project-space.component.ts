import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Project, ProjectsApi } from './projects.api';

@Component({
  selector: 'app-project-space',
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="project-space" data-testid="project-space">
      <header class="page-header">
        <a routerLink="/projects">← Projects</a>
        <h1 data-testid="project-title">{{ project()?.organizationName || project()?.name || 'Project' }}</h1>
      </header>
      @if (error()) {
        <p role="alert" data-testid="project-error">{{ error() }}</p>
      } @else {
        <section class="file-explorer" data-testid="file-explorer">
          <h2>Files</h2>
          <p class="muted">No files yet.</p>
        </section>
        <section class="chat-area" data-testid="chat-area">
          <h2>Chat</h2>
          <p class="muted"># general</p>
        </section>
      }
    </div>
  `,
  styles: [`
    .project-space { display: flex; flex-direction: column; gap: 1rem; padding: 2rem 1rem; max-width: 1000px; margin: 0 auto; }
    .file-explorer, .chat-area { border: 1px solid var(--color-border); border-radius: 8px; padding: 1rem; }
    .muted { opacity: 0.7; }
  `],
})
export class ProjectSpaceComponent implements OnInit {
  private api = inject(ProjectsApi);
  private route = inject(ActivatedRoute);

  project = signal<Project | null>(null);
  error = signal<string | null>(null);

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id') ?? '';
    this.api
      .get(id)
      .then((p) => this.project.set(p))
      .catch(() => this.error.set('You do not have access to this project.'));
  }
}
