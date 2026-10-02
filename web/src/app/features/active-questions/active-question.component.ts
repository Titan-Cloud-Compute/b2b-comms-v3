import {
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { SafeHtmlPipe } from '../../shared/safe-html.pipe';
import { ActiveQuestionsApiService } from './active-questions-api.service';
import { MessageDto, QuestionDto } from './active-questions.types';

@Component({
  selector: 'app-active-question',
  standalone: true,
  imports: [RouterLink, FormsModule, SafeHtmlPipe],
  template: `
    <div class="aq-page" data-testid="aq-page">
      <aside class="aq-sidebar">
        <a [routerLink]="['/projects', projectId()]">← Project</a>

        <section class="aq-list-section">
          <h2 data-testid="active-questions-heading">Active Questions</h2>

          @if (listError()) {
            <p role="alert" data-testid="aq-list-error">{{ listError() }}</p>
          }

          <ul class="aq-list">
            @for (q of questions(); track q.id) {
              <li>
                <a
                  data-testid="question-item"
                  [class.active]="q.id === channelId()"
                  [routerLink]="['/projects', projectId(), 'questions', q.id]"
                >{{ q.title }}</a>
                <span class="badge" [class.resolved]="q.status === 'resolved'">{{ q.status }}</span>
              </li>
            }
          </ul>

          <form class="new-question-form" (submit)="$event.preventDefault(); submitNewQuestion()">
            <input
              data-testid="new-question-title"
              [(ngModel)]="newTitle"
              placeholder="Question title"
            />
            <textarea
              data-testid="new-question-body"
              [(ngModel)]="newBody"
              placeholder="First message…"
            ></textarea>
            @if (createError()) {
              <p role="alert" data-testid="new-question-error">{{ createError() }}</p>
            }
            <button type="submit" data-testid="new-question-submit">Ask question</button>
          </form>
        </section>
      </aside>

      <section class="aq-thread">
        @if (currentQuestion()) {
          <h1 data-testid="question-title">{{ currentQuestion()!.title }}</h1>

          @if (threadError()) {
            <p role="alert" data-testid="question-error">{{ threadError() }}</p>
          }

          <ol class="message-list" data-testid="message-list">
            @for (m of threadMessages(); track m.id) {
              <li data-testid="question-message" [innerHTML]="m.body_html | safeHtml"></li>
            }
          </ol>

          @if (currentQuestion()!.status === 'resolved') {
            <p data-testid="question-resolved">Resolved</p>
          } @else {
            @if (isAwaiting()) {
              <p data-testid="question-awaiting">awaiting the other party's resolution</p>
              <button type="button" data-testid="question-withdraw" (click)="withdraw()">Withdraw</button>
            } @else {
              <button type="button" data-testid="question-resolve" (click)="resolve()">Mark resolved</button>
            }

            <div class="aq-composer" data-testid="question-composer">
              <textarea
                data-testid="question-composer-input"
                [(ngModel)]="composerText"
                placeholder="Write a message…"
              ></textarea>
              @if (composerError()) {
                <p role="alert" data-testid="question-composer-error">{{ composerError() }}</p>
              }
              <button type="button" data-testid="question-send" (click)="sendMessage()">Send</button>
            </div>
          }
        }
      </section>
    </div>
  `,
  styles: [`
    .aq-page { display: flex; gap: 1rem; padding: 2rem 1rem; max-width: 1100px; margin: 0 auto; }
    .aq-sidebar { flex: 0 0 260px; border: 1px solid var(--color-border); border-radius: 8px; padding: 1rem; }
    .aq-list { list-style: none; padding: 0; }
    .aq-list li { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.25rem; }
    .aq-list a.active { font-weight: bold; }
    .badge { font-size: 0.75rem; padding: 0.1rem 0.4rem; border-radius: 99px; background: var(--color-border); }
    .badge.resolved { background: #d1fae5; color: #065f46; }
    .new-question-form { margin-top: 1rem; display: flex; flex-direction: column; gap: 0.5rem; }
    .new-question-form input, .new-question-form textarea {
      border: 1px solid var(--color-border); border-radius: 6px; padding: 0.4rem; width: 100%;
    }
    .aq-thread { flex: 1; display: flex; flex-direction: column; gap: 0.5rem; }
    .message-list { list-style: none; padding: 0; display: flex; flex-direction: column; gap: 0.5rem; }
    .message-list li { border: 1px solid var(--color-border); border-radius: 8px; padding: 0.5rem; }
    .aq-composer { margin-top: 1rem; display: flex; flex-direction: column; gap: 0.5rem; }
    .aq-composer textarea { border: 1px solid var(--color-border); border-radius: 8px; padding: 0.5rem; min-height: 5rem; }
  `],
})
export class ActiveQuestionComponent implements OnInit, OnDestroy {
  private api = inject(ActiveQuestionsApiService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  projectId = signal('');
  channelId = signal('');
  questions = signal<QuestionDto[]>([]);
  threadMessages = signal<MessageDto[]>([]);
  listError = signal<string | null>(null);
  threadError = signal<string | null>(null);
  createError = signal<string | null>(null);
  composerError = signal<string | null>(null);

  newTitle = '';
  newBody = '';
  composerText = '';

  currentQuestion = computed(() =>
    this.questions().find((q) => q.id === this.channelId()) ?? null,
  );

  isAwaiting = computed(() => {
    const q = this.currentQuestion();
    if (!q || q.status !== 'open') return false;
    return q.resolvedSides.includes(q.mySide);
  });

  private sub?: Subscription;

  ngOnInit(): void {
    this.sub = this.route.paramMap.subscribe((params) => {
      const projectId = params.get('id') ?? '';
      const channelId = params.get('channelId') ?? '';
      const projectChanged = projectId !== this.projectId();
      this.projectId.set(projectId);
      this.channelId.set(channelId);
      if (projectChanged) void this.loadQuestions();
      else void this.refreshCurrentQuestion();
      void this.loadMessages();
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  async loadQuestions(): Promise<void> {
    try {
      this.questions.set(await this.api.list(this.projectId()));
      this.listError.set(null);
    } catch (e) {
      const status = (e as { status?: number } | null)?.status;
      this.listError.set(
        status === 403
          ? 'You are not a member of this project'
          : 'Questions could not be loaded.',
      );
    }
  }

  async refreshCurrentQuestion(): Promise<void> {
    try {
      const list = await this.api.list(this.projectId());
      this.questions.set(list);
      this.listError.set(null);
    } catch {
      // silent refresh; existing list stays visible
    }
  }

  async loadMessages(): Promise<void> {
    const channelId = this.channelId();
    try {
      const msgs = await this.api.messages(channelId);
      if (channelId !== this.channelId()) return;
      this.threadMessages.set(msgs);
      this.threadError.set(null);
    } catch (e) {
      if (channelId !== this.channelId()) return;
      this.threadMessages.set([]);
      const status = (e as { status?: number } | null)?.status;
      this.threadError.set(
        status === 403
          ? 'You are not a member of this project'
          : 'Messages could not be loaded.',
      );
    }
  }

  async submitNewQuestion(): Promise<void> {
    if (!this.newTitle.trim()) {
      this.createError.set('Title is required.');
      return;
    }
    this.createError.set(null);
    try {
      const created = await this.api.create(this.projectId(), {
        title: this.newTitle.trim(),
        body_html: this.newBody,
      });
      this.questions.update((list) => [...list, created]);
      this.newTitle = '';
      this.newBody = '';
      void this.router.navigate(['/projects', this.projectId(), 'questions', created.id]);
    } catch (e) {
      const err = e as { status?: number; message?: string } | null;
      this.createError.set(
        err?.message ?? (err?.status === 400 ? 'Invalid question.' : 'Could not create question.'),
      );
    }
  }

  async sendMessage(): Promise<void> {
    if (!this.composerText.trim()) {
      this.composerError.set('Message cannot be empty.');
      return;
    }
    const text = this.composerText;
    this.composerError.set(null);
    this.composerText = '';
    try {
      const msg = await this.api.post(this.channelId(), text);
      this.threadMessages.update((list) => [...list, msg]);
      await this.refreshCurrentQuestion();
    } catch {
      this.composerText = text;
      this.composerError.set('Message could not be sent.');
    }
  }

  async resolve(): Promise<void> {
    try {
      const updated = await this.api.resolve(this.channelId());
      this.questions.update((list) =>
        list.map((q) => (q.id === updated.id ? updated : q)),
      );
    } catch {
      this.threadError.set('Could not mark resolved.');
    }
  }

  async withdraw(): Promise<void> {
    try {
      const updated = await this.api.withdraw(this.channelId());
      this.questions.update((list) =>
        list.map((q) => (q.id === updated.id ? updated : q)),
      );
    } catch {
      this.threadError.set('Could not withdraw resolution.');
    }
  }
}
