import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { Channel, ChannelMessage, ChannelsApi } from '../general-channels/channels.api';
import { Question, QuestionsApi } from './questions.api';

function isBlankHtml(html: string): boolean {
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;| /g, ' ').trim().length === 0;
}

function statusOf(e: unknown): number | undefined {
  return (e as { status?: number } | null)?.status;
}

@Component({
  selector: 'app-question',
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="channel-page" data-testid="question-page">
      <aside class="channel-list">
        <a [routerLink]="['/projects', projectId()]">← Project</a>
        <h2 data-testid="general-channels-heading">General Channels</h2>
        <ul>
          @for (c of channels(); track c.id) {
            <li><a data-testid="channel-link" [routerLink]="['/projects', projectId(), 'channels', c.id]"># {{ c.name }}</a></li>
          }
        </ul>
        <h2 data-testid="active-questions-heading">Active Questions</h2>
        @if (listError()) { <p role="alert" data-testid="questions-error">{{ listError() }}</p> }
        <ul>
          @for (q of questions(); track q.id) {
            <li>
              <a data-testid="question-link"
                 [class.active]="q.id === channelId()"
                 [routerLink]="['/projects', projectId(), 'questions', q.id]">? {{ q.name }}</a>
              @if (q.status === 'resolved') { <span class="tag" data-testid="question-link-resolved">resolved</span> }
            </li>
          }
        </ul>
        <form class="new-question" (submit)="$event.preventDefault(); create(titleInput, firstMessage)">
          <input #titleInput data-testid="new-question-title" placeholder="Question title" />
          <div #firstMessage class="editor" contenteditable="true" data-testid="new-question-message" aria-label="First message"></div>
          <button type="submit" data-testid="create-question">Ask question</button>
          @if (createError()) { <p role="alert" data-testid="create-question-error">{{ createError() }}</p> }
        </form>
      </aside>

      <section class="channel-main">
        <h1 data-testid="question-title">? {{ current()?.name || 'Question' }}</h1>
        @if (current(); as q) {
          <p data-testid="question-status">Status: {{ q.status }}</p>
          @if (q.status === 'resolved') {
            <p data-testid="question-resolved">Resolved by both parties.</p>
          } @else {
            @if (resolvedByMe()) {
              <p data-testid="question-awaiting">Marked resolved — awaiting the other party's resolution.</p>
              <button type="button" data-testid="withdraw-resolution" (click)="withdraw()">Withdraw resolution</button>
            } @else {
              @if (q.resolvedSides.length > 0) {
                <p data-testid="question-other-resolved">The other party marked this resolved.</p>
              }
              <button type="button" data-testid="resolve-question" (click)="resolve()">Mark resolved</button>
            }
          }
        }
        @if (error()) { <p role="alert" data-testid="question-error">{{ error() }}</p> }
        <ol class="message-list" data-testid="message-list">
          @for (m of messages(); track m.id) {
            <li class="message" data-testid="message">
              <strong class="author">{{ m.authorName || 'Someone' }}</strong>
              @if (m.deletedAt) {
                <em class="muted" data-testid="message-removed">Message removed</em>
              } @else {
                <div class="body" data-testid="message-body" [innerHTML]="m.bodyHtml"></div>
                @if (m.editedAt) { <span class="muted" data-testid="message-edited">(edited)</span> }
              }
            </li>
          }
        </ol>
        @if (current()?.status !== 'resolved') {
          <div class="composer">
            <div class="toolbar">
              <button type="button" data-testid="format-bold" (mousedown)="$event.preventDefault(); format('bold')"><b>B</b></button>
              <button type="button" data-testid="format-italic" (mousedown)="$event.preventDefault(); format('italic')"><i>I</i></button>
              <button type="button" data-testid="format-list" (mousedown)="$event.preventDefault(); format('insertUnorderedList')">• List</button>
            </div>
            <div #composer class="editor" contenteditable="true" data-testid="composer" aria-label="Message"></div>
            <button type="button" data-testid="send-message" (click)="send(composer)">Send</button>
            @if (composerError()) { <p role="alert" data-testid="composer-error">{{ composerError() }}</p> }
          </div>
        }
      </section>
    </div>
  `,
  styles: [`
    .channel-page { display: flex; gap: 1rem; padding: 2rem 1rem; max-width: 1100px; margin: 0 auto; }
    .channel-list { flex: 0 0 240px; border: 1px solid var(--color-border); border-radius: 8px; padding: 1rem; }
    .channel-list ul { list-style: none; padding: 0; }
    .channel-list a.active { font-weight: bold; }
    .channel-main { flex: 1; display: flex; flex-direction: column; gap: 0.5rem; }
    .message-list { list-style: none; padding: 0; display: flex; flex-direction: column; gap: 0.5rem; }
    .message { border: 1px solid var(--color-border); border-radius: 8px; padding: 0.5rem; }
    .editor { min-height: 3rem; border: 1px solid var(--color-border); border-radius: 8px; padding: 0.5rem; }
    .muted, .tag { opacity: 0.7; }
  `],
})
export class QuestionComponent implements OnInit, OnDestroy {
  private api = inject(QuestionsApi);
  private channelsApi = inject(ChannelsApi);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  projectId = signal('');
  channelId = signal('');
  channels = signal<Channel[]>([]);
  questions = signal<Question[]>([]);
  messages = signal<ChannelMessage[]>([]);
  error = signal<string | null>(null);
  listError = signal<string | null>(null);
  createError = signal<string | null>(null);
  composerError = signal<string | null>(null);

  current = computed(() => this.questions().find((q) => q.id === this.channelId()) ?? null);
  resolvedByMe = computed(() => {
    const q = this.current();
    return !!q && q.resolvedSides.includes(q.mySide);
  });

  private sub?: Subscription;

  ngOnInit(): void {
    this.sub = this.route.paramMap.subscribe((params) => {
      const projectId = params.get('id') ?? '';
      const projectChanged = projectId !== this.projectId();
      this.projectId.set(projectId);
      this.channelId.set(params.get('channelId') ?? '');
      if (projectChanged) {
        void this.loadChannels();
        void this.loadQuestions();
      }
      void this.loadMessages();
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  async loadChannels(): Promise<void> {
    try {
      this.channels.set(await this.channelsApi.listChannels(this.projectId()));
    } catch {
      this.channels.set([]);
    }
  }

  async loadQuestions(): Promise<void> {
    try {
      this.questions.set(await this.api.list(this.projectId()));
      this.listError.set(null);
    } catch (e) {
      this.listError.set(statusOf(e) === 403 ? 'You do not have access to this project.' : 'Questions could not be loaded.');
    }
  }

  async loadMessages(): Promise<void> {
    const channelId = this.channelId();
    try {
      const list = await this.channelsApi.listMessages(channelId);
      if (channelId !== this.channelId()) return;
      this.messages.set([...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
      this.error.set(null);
    } catch (e) {
      if (channelId !== this.channelId()) return;
      this.messages.set([]);
      this.error.set(statusOf(e) === 403 ? 'You do not have access to this question.' : 'Messages could not be loaded.');
    }
  }

  async create(titleInput: HTMLInputElement, firstMessage: HTMLElement): Promise<void> {
    const title = titleInput.value.trim();
    const bodyHtml = firstMessage.innerHTML;
    if (!title || isBlankHtml(bodyHtml)) {
      this.createError.set('A title and a first message are required.');
      return;
    }
    try {
      const created = await this.api.create(this.projectId(), title, bodyHtml);
      this.upsertQuestion(created);
      titleInput.value = '';
      firstMessage.innerHTML = '';
      this.createError.set(null);
      await this.router.navigate(['/projects', this.projectId(), 'questions', created.id]);
    } catch (e) {
      this.createError.set(statusOf(e) === 400 ? 'A title and a first message are required.' : 'Question could not be created.');
    }
  }

  async resolve(): Promise<void> {
    try {
      this.upsertQuestion(await this.api.resolve(this.channelId()));
      this.error.set(null);
    } catch {
      this.error.set('Question could not be marked resolved.');
    }
  }

  async withdraw(): Promise<void> {
    try {
      this.upsertQuestion(await this.api.withdraw(this.channelId()));
      this.error.set(null);
    } catch {
      this.error.set('Resolution could not be withdrawn.');
    }
  }

  format(command: string): void {
    if (typeof document !== 'undefined') document.execCommand(command, false);
  }

  async send(composer: HTMLElement): Promise<void> {
    const bodyHtml = composer.innerHTML;
    if (isBlankHtml(bodyHtml)) {
      this.composerError.set('Message cannot be empty.');
      return;
    }
    try {
      const saved = await this.channelsApi.postMessage(this.channelId(), bodyHtml);
      composer.innerHTML = '';
      this.composerError.set(null);
      this.messages.update((list) => [...list.filter((m) => m.id !== saved.id), saved]);
      // A new message clears any resolution marks server-side.
      const q = this.current();
      if (q) this.upsertQuestion({ ...q, resolvedSides: [] });
    } catch (e) {
      this.composerError.set(statusOf(e) === 403 ? 'This question is resolved; no further messages.' : 'Message could not be sent.');
    }
  }

  private upsertQuestion(q: Question): void {
    this.questions.update((list) => (list.some((x) => x.id === q.id) ? list.map((x) => (x.id === q.id ? q : x)) : [...list, q]));
  }
}
