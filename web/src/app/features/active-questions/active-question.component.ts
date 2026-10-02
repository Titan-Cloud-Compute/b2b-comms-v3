import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { SafeHtmlPipe } from '../../shared/safe-html.pipe';
import { ActiveQuestionsApiService } from './active-questions-api.service';
import { MessageDto, QuestionDto } from './active-questions.types';

@Component({
  selector: 'app-active-question',
  standalone: true,
  imports: [RouterLink, SafeHtmlPipe],
  template: `
    <div class="aq-page">
      <aside class="aq-sidebar">
        <h2 data-testid="active-questions-heading">Active Questions</h2>

        @if (listError()) {
          <p role="alert" data-testid="aq-list-error">{{ listError() }}</p>
        }

        <ul class="aq-list">
          @for (q of questions(); track q.id) {
            <li>
              <a data-testid="question-item"
                 [class.active]="q.id === channelId()"
                 [routerLink]="['/projects', projectId(), 'questions', q.id]">
                {{ q.title }}
              </a>
              <span class="status-badge" [attr.data-status]="q.status">{{ q.status }}</span>
            </li>
          }
        </ul>

        <form class="new-question-form" (submit)="$event.preventDefault(); submitNewQuestion(titleInput, bodyInput)">
          <input #titleInput
                 data-testid="new-question-title"
                 placeholder="Question title"
                 type="text" />
          <textarea #bodyInput
                    data-testid="new-question-body"
                    placeholder="First message (HTML)"></textarea>
          <button type="submit" data-testid="new-question-submit">Ask question</button>
          @if (createError()) {
            <p role="alert" data-testid="create-question-error">{{ createError() }}</p>
          }
        </form>
      </aside>

      <section class="aq-thread">
        @if (accessError()) {
          <p role="alert" data-testid="aq-access-error">You are not a member of this project</p>
        } @else if (currentQuestion()) {
          <h1 data-testid="question-title">{{ currentQuestion()!.title }}</h1>

          <ol class="message-list" data-testid="message-list">
            @for (m of messages(); track m.id) {
              <li class="message" data-testid="question-message">
                <div class="body" [innerHTML]="m.bodyHtml | safeHtml"></div>
              </li>
            }
          </ol>

          @if (currentQuestion()!.status === 'resolved') {
            <p data-testid="question-resolved">Resolved</p>
          } @else {
            <div class="composer" data-testid="question-composer">
              <textarea #composerInput
                        data-testid="question-composer-input"
                        placeholder="Type a message (HTML)"></textarea>
              <button type="button" data-testid="question-send" (click)="sendMessage(composerInput)">Send</button>
              @if (composerError()) {
                <p role="alert" data-testid="question-composer-error">{{ composerError() }}</p>
              }
            </div>

            @if (showResolve()) {
              <button type="button" data-testid="question-resolve" (click)="markResolved()">Mark resolved</button>
            }
            @if (showAwaiting()) {
              <p data-testid="question-awaiting">awaiting the other party's resolution</p>
              <button type="button" data-testid="question-withdraw" (click)="withdraw()">Withdraw</button>
            }
          }
        }
      </section>
    </div>
  `,
  styles: [`
    .aq-page { display: flex; gap: 1rem; padding: 2rem 1rem; max-width: 1100px; margin: 0 auto; }
    .aq-sidebar { flex: 0 0 260px; border: 1px solid var(--color-border, #ccc); border-radius: 8px; padding: 1rem; }
    .aq-list { list-style: none; padding: 0; }
    .aq-list a.active { font-weight: bold; }
    .aq-thread { flex: 1; display: flex; flex-direction: column; gap: 0.5rem; }
    .message-list { list-style: none; padding: 0; display: flex; flex-direction: column; gap: 0.5rem; }
    .message { border: 1px solid var(--color-border, #ccc); border-radius: 8px; padding: 0.5rem; }
    .status-badge { margin-left: 0.5rem; font-size: 0.75rem; opacity: 0.7; }
    .new-question-form { display: flex; flex-direction: column; gap: 0.5rem; margin-top: 1rem; }
    .new-question-form input,
    .new-question-form textarea { border: 1px solid var(--color-border, #ccc); border-radius: 4px; padding: 0.4rem; }
    .composer { display: flex; flex-direction: column; gap: 0.5rem; margin-top: 0.5rem; }
    .composer textarea { min-height: 3rem; border: 1px solid var(--color-border, #ccc); border-radius: 8px; padding: 0.5rem; }
  `],
})
export class ActiveQuestionComponent implements OnInit, OnDestroy {
  private api = inject(ActiveQuestionsApiService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  projectId = signal('');
  channelId = signal('');
  questions = signal<QuestionDto[]>([]);
  messages = signal<MessageDto[]>([]);
  listError = signal<string | null>(null);
  createError = signal<string | null>(null);
  composerError = signal<string | null>(null);
  accessError = signal(false);

  currentQuestion = computed(() => this.questions().find(q => q.id === this.channelId()) ?? null);

  showResolve = computed(() => {
    const q = this.currentQuestion();
    if (!q || q.status !== 'open') return false;
    return !q.resolvedSides.includes(q.mySide);
  });

  showAwaiting = computed(() => {
    const q = this.currentQuestion();
    if (!q || q.status !== 'open') return false;
    return q.resolvedSides.includes(q.mySide);
  });

  private sub?: Subscription;

  ngOnInit(): void {
    this.sub = this.route.paramMap.subscribe(params => {
      const projectId = params.get('id') ?? '';
      const channelId = params.get('channelId') ?? '';
      const projectChanged = projectId !== this.projectId();
      this.projectId.set(projectId);
      this.channelId.set(channelId);
      if (projectChanged) void this.loadQuestions();
      void this.loadMessages();
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  async loadQuestions(): Promise<void> {
    try {
      const list = await this.api.list(this.projectId());
      this.questions.set(list);
      this.listError.set(null);
    } catch (e) {
      const status = (e as { status?: number } | null)?.status;
      if (status === 403) {
        this.accessError.set(true);
      } else {
        this.listError.set('Questions could not be loaded.');
      }
    }
  }

  async loadMessages(): Promise<void> {
    const channelId = this.channelId();
    if (!channelId) return;
    try {
      const list = await this.api.messages(channelId);
      if (channelId !== this.channelId()) return;
      this.messages.set(list);
    } catch (e) {
      if (channelId !== this.channelId()) return;
      this.messages.set([]);
      const status = (e as { status?: number } | null)?.status;
      if (status === 403) this.accessError.set(true);
    }
  }

  async submitNewQuestion(titleInput: HTMLInputElement, bodyInput: HTMLTextAreaElement): Promise<void> {
    const title = titleInput.value.trim();
    if (!title) {
      this.createError.set('Title is required.');
      return;
    }
    const body_html = bodyInput.value;
    try {
      const created = await this.api.create(this.projectId(), { title, body_html });
      this.questions.update(list => [...list, created]);
      titleInput.value = '';
      bodyInput.value = '';
      this.createError.set(null);
      await this.router.navigate(['/projects', this.projectId(), 'questions', created.id]);
    } catch (e) {
      const err = e as { status?: number; message?: string } | null;
      if (err?.status === 400) {
        this.createError.set(err?.message ?? 'Validation error.');
      } else {
        this.createError.set('Question could not be created.');
      }
    }
  }

  async sendMessage(composerInput: HTMLTextAreaElement): Promise<void> {
    const bodyHtml = composerInput.value.trim();
    if (!bodyHtml) {
      this.composerError.set('Message cannot be empty.');
      return;
    }
    this.composerError.set(null);
    composerInput.value = '';
    try {
      const msg = await this.api.postMessage(this.channelId(), bodyHtml);
      this.messages.update(list => [...list, msg]);
      await this.loadMessages();
    } catch {
      composerInput.value = bodyHtml;
      this.composerError.set('Message could not be sent.');
    }
  }

  async markResolved(): Promise<void> {
    try {
      const updated = await this.api.resolve(this.channelId());
      this.upsertQuestion(updated);
    } catch {
      // silently ignore for now
    }
  }

  async withdraw(): Promise<void> {
    try {
      const updated = await this.api.withdraw(this.channelId());
      this.upsertQuestion(updated);
    } catch {
      // silently ignore for now
    }
  }

  private upsertQuestion(q: QuestionDto): void {
    this.questions.update(list =>
      list.some(x => x.id === q.id) ? list.map(x => (x.id === q.id ? q : x)) : [...list, q],
    );
  }
}
