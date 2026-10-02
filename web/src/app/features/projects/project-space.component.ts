import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Project, ProjectsApi } from './projects.api';
import { Question, QuestionsApi } from '../active-questions/questions.api';

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
        <section class="chat-area" data-testid="project-active-questions">
          <h2>Active Questions</h2>
          <ul>
            @for (q of questions(); track q.id) {
              <li><a data-testid="project-question-link" [routerLink]="['/projects', projectId, 'questions', q.id]">? {{ q.name }}</a>
                @if (q.status === 'resolved') { <span class="muted">resolved</span> }</li>
            } @empty {
              <li class="muted">No active questions yet.</li>
            }
          </ul>
          <form (submit)="$event.preventDefault(); ask(qTitle, qBody)">
            <input #qTitle data-testid="project-new-question-title" placeholder="Question title" />
            <input #qBody data-testid="project-new-question-message" placeholder="First message" />
            <button type="submit" data-testid="project-create-question">Ask question</button>
            @if (askError()) { <p role="alert">{{ askError() }}</p> }
          </form>
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
  private router = inject(Router);
  private questionsApi = inject(QuestionsApi);

  project = signal<Project | null>(null);
  error = signal<string | null>(null);
  questions = signal<Question[]>([]);
  askError = signal<string | null>(null);
  projectId = '';

  async ask(title: HTMLInputElement, body: HTMLInputElement): Promise<void> {
    const t = title.value.trim();
    const b = body.value.trim();
    if (!t || !b) {
      this.askError.set('A title and a first message are required.');
      return;
    }
    try {
      const q = await this.questionsApi.create(this.projectId, t, b);
      this.askError.set(null);
      await this.router.navigate(['/projects', this.projectId, 'questions', q.id]);
    } catch {
      this.askError.set('Question could not be created.');
    }
  }

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id') ?? '';
    this.projectId = id;
    this.questionsApi
      .list(id)
      .then((list) => this.questions.set(Array.isArray(list) ? list : []))
      .catch(() => this.questions.set([]));
    this.api
      .get(id)
      .then((p) => this.project.set(p))
      .catch(() => this.error.set('You do not have access to this project.'));
  }
}
