import { Component, DestroyRef, ElementRef, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../shared/auth.service';
import {
  ChannelMessage,
  GeneralChannelsApiService,
  errorMessage,
  errorStatus,
} from '../general-channels/general-channels-api.service';
import { ActiveQuestionChatsApiService, QuestionItem } from './active-question-chats-api.service';

/**
 * Active question thread: Active Questions list (below General Channels),
 * new-question form, message thread + composer (General Channels endpoints)
 * and the two-party Resolve / Withdraw controls.
 */
@Component({
  selector: 'app-active-question',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <div class="gc" data-testid="active-question-page">
      <aside class="gc-sidebar">
        <a [routerLink]="['/projects', projectId()]">Back to project</a>
        <section data-testid="active-questions-section" aria-labelledby="aq-heading">
          <h2 id="aq-heading">Active Questions</h2>
          <ul class="gc-channels" data-testid="active-questions-list">
            @for (q of questions(); track q.id) {
              <li [class.active]="q.id === channelId()" data-testid="active-question-item">
                <a [routerLink]="['/projects', projectId(), 'questions', q.id]">{{ q.name }}</a>
                <span class="tag">{{ q.status }}</span>
                @if (q.unread_count > 0) { <span class="badge">{{ q.unread_count }}</span> }
              </li>
            } @empty {
              @if (!loadingList()) { <li class="muted">No active questions yet</li> }
            }
          </ul>
          <form class="gc-new" (ngSubmit)="createQuestion()" data-testid="create-question-form">
            <input name="qTitle" placeholder="Question title" [(ngModel)]="newTitle" data-testid="create-question-title" />
            <textarea name="qBody" placeholder="First message" [(ngModel)]="newBody" data-testid="create-question-body"></textarea>
            <button type="submit" [disabled]="!newTitle.trim() || !newBody.trim()" data-testid="create-question-submit">Ask question</button>
          </form>
        </section>
      </aside>

      <main class="gc-main">
        <h1 data-testid="question-title">{{ current()?.name ?? 'Question' }}</h1>
        <p class="status" data-testid="question-status" [attr.data-status]="statusKey()">{{ statusText() }}</p>
        @if (current(); as q) {
          <div class="gc-actions">
            @if (q.status !== 'resolved') {
              <button type="button" (click)="resolve()" [disabled]="busy()" data-testid="question-resolve">Mark resolved</button>
              @if (sides().length) {
                <button type="button" (click)="withdraw()" [disabled]="busy()" data-testid="question-withdraw">Withdraw resolution</button>
              }
            }
          </div>
        }
        @if (error(); as e) { <div class="error" role="alert" data-testid="question-error">{{ e }}</div> }

        <div class="gc-messages" data-testid="message-list" aria-live="polite">
          @for (m of messages(); track m.id) {
            <article class="gc-msg" data-testid="message" [attr.data-message-id]="m.id">
              <header>
                <strong>{{ m.author.display_name }}</strong>
                <time>{{ m.created_at ? m.created_at.slice(0, 16).replace('T', ' ') : '' }}</time>
                @if (m.edited_at) { <span class="edited">(edited)</span> }
              </header>
              <div class="gc-body" data-testid="message-body" [innerHTML]="m.body_html"></div>
              @if (m.attachments.length) {
                <ul class="gc-atts">
                  @for (a of m.attachments; track a.file_id) { <li data-testid="message-attachment">📎 {{ a.name }}</li> }
                </ul>
              }
            </article>
          } @empty {
            @if (!loadingMessages()) { <p class="muted" data-testid="message-empty">No messages yet.</p> }
          }
        </div>

        @if (current()?.status === 'resolved') {
          <p class="muted" data-testid="question-closed">This question is resolved and closed to new messages.</p>
        } @else {
          <form class="gc-composer" data-testid="message-composer" (ngSubmit)="send()">
            <div class="gc-toolbar" role="toolbar" aria-label="Formatting">
              <button type="button" (mousedown)="$event.preventDefault()" (click)="format('bold')" data-testid="composer-bold" aria-label="Bold"><b>B</b></button>
              <button type="button" (mousedown)="$event.preventDefault()" (click)="format('italic')" data-testid="composer-italic" aria-label="Italic"><i>I</i></button>
              <button type="button" (mousedown)="$event.preventDefault()" (click)="format('insertUnorderedList')" aria-label="Bulleted list">• List</button>
              <label class="gc-attach">📎 Attach
                <input type="file" multiple (change)="onFiles($event)" data-testid="composer-attach" />
              </label>
            </div>
            <div #editor class="gc-input" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Message"
                 data-testid="composer-input"></div>
            @if (attachments().length) {
              <ul class="gc-atts">
                @for (a of attachments(); track a.file_id) { <li>📎 {{ a.name }}</li> }
              </ul>
            }
            <button type="submit" data-testid="composer-send" [disabled]="busy()">Send</button>
          </form>
        }
      </main>
    </div>
  `,
  styles: [`
    .gc { display: flex; gap: 1rem; min-height: 70vh; }
    .gc-sidebar { width: 240px; flex-shrink: 0; }
    .gc-channels { list-style: none; padding: 0; }
    .gc-channels li.active a { font-weight: 600; }
    .gc-new { display: flex; flex-direction: column; gap: 0.25rem; }
    .gc-main { flex: 1; display: flex; flex-direction: column; min-width: 0; }
    .gc-messages { flex: 1; overflow-y: auto; }
    .gc-msg { padding: 0.5rem 0; border-bottom: 1px solid #eee; }
    .edited, .tag, .muted, .status { color: #666; font-size: 0.85em; }
    .gc-input { border: 1px solid #ccc; border-radius: 4px; min-height: 3rem; padding: 0.5rem; }
    .gc-attach input { display: none; }
    .error { color: #b00020; }
    .badge { background: #d33; color: #fff; border-radius: 999px; padding: 0 0.4rem; font-size: 0.8em; }
  `],
})
export class QuestionComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private api = inject(ActiveQuestionChatsApiService);
  private channelsApi = inject(GeneralChannelsApiService);
  private auth = inject(AuthService);
  private destroyRef = inject(DestroyRef);

  @ViewChild('editor') editor?: ElementRef<HTMLDivElement>;

  projectId = signal('');
  channelId = signal('');
  questions = signal<QuestionItem[]>([]);
  messages = signal<ChannelMessage[]>([]);
  attachments = signal<{ file_id: string; name: string }[]>([]);
  error = signal<string | null>(null);
  loadingList = signal(false);
  loadingMessages = signal(false);
  busy = signal(false);
  newTitle = '';
  newBody = '';

  private me = computed(() => this.auth.user() as unknown as { name?: string; email?: string } | null);
  current = computed(() => this.questions().find((q) => q.id === this.channelId()) ?? null);
  sides = computed(() => (this.current()?.resolved_sides ?? '').split(',').map((s) => s.trim()).filter(Boolean));
  statusKey = computed(() => {
    const q = this.current();
    if (!q) return 'open';
    if (q.status === 'resolved') return 'resolved';
    return this.sides().length ? 'awaiting' : 'open';
  });
  statusText = computed(() => {
    const k = this.statusKey();
    if (k === 'resolved') return 'resolved';
    if (k === 'awaiting') return "awaiting the other party's resolution";
    return 'open';
  });

  ngOnInit(): void {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const pid = params.get('id') ?? '';
      const projectChanged = pid !== this.projectId();
      this.projectId.set(pid);
      this.channelId.set(params.get('channelId') ?? '');
      this.error.set(null);
      if (projectChanged) void this.loadList();
      void this.loadMessages();
    });
  }

  async loadList(): Promise<void> {
    this.loadingList.set(true);
    try {
      this.questions.set((await this.api.list(this.projectId())).items ?? []);
    } catch (e) {
      this.error.set(errorStatus(e) === 403 ? 'You do not have access to this project.' : errorMessage(e));
    } finally {
      this.loadingList.set(false);
    }
  }

  async loadMessages(): Promise<void> {
    const cid = this.channelId();
    this.loadingMessages.set(true);
    try {
      const page = await this.channelsApi.messages(cid);
      if (cid === this.channelId()) this.messages.set([...page.items].reverse());
    } catch (e) {
      if (cid !== this.channelId()) return;
      this.messages.set([]);
      this.error.set(errorStatus(e) === 403 ? 'You do not have access to this question.' : errorMessage(e));
    } finally {
      this.loadingMessages.set(false);
    }
  }

  private patchCurrent(res: { id: string; status: string; resolved_sides: string }): void {
    this.questions.update((list) =>
      list.map((q) => (q.id === res.id ? { ...q, status: res.status, resolved_sides: res.resolved_sides } : q)),
    );
  }

  async resolve(): Promise<void> {
    await this.mutate(() => this.api.resolve(this.channelId()));
  }

  async withdraw(): Promise<void> {
    await this.mutate(() => this.api.withdraw(this.channelId()));
  }

  private async mutate(fn: () => Promise<{ id: string; status: string; resolved_sides: string }>): Promise<void> {
    this.busy.set(true);
    try {
      this.patchCurrent(await fn());
      this.error.set(null);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  format(command: 'bold' | 'italic' | 'insertUnorderedList'): void {
    this.editor?.nativeElement.focus();
    document.execCommand(command, false);
  }

  async onFiles(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    try {
      for (const f of files) {
        const up = await this.channelsApi.uploadAttachment(this.projectId(), f);
        this.attachments.update((a) => [...a, { file_id: up.id, name: up.name }]);
      }
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }

  async send(): Promise<void> {
    const el = this.editor?.nativeElement;
    const html = (el?.innerHTML ?? '').trim();
    const text = (el?.textContent ?? '').trim();
    const atts = this.attachments();
    if (!text && !atts.length) {
      this.error.set('Message cannot be empty.');
      return;
    }
    this.busy.set(true);
    try {
      const res = await this.channelsApi.send(this.channelId(), html, atts.map((a) => a.file_id));
      if (el) el.innerHTML = '';
      this.attachments.set([]);
      this.messages.update((list) => [
        ...list,
        {
          id: res.id,
          channel_id: res.channel_id,
          author: { id: res.author_id, display_name: this.me()?.name || this.me()?.email || 'You' },
          body_html: res.body_html,
          attachments: atts,
          reference_id: null,
          edited_at: null,
          created_at: res.created_at,
        },
      ]);
      // A new message clears both parties' resolution marks.
      this.questions.update((list) => list.map((q) => (q.id === this.channelId() ? { ...q, resolved_sides: '' } : q)));
      this.error.set(null);
    } catch (e) {
      this.error.set(errorStatus(e) === 403 ? 'This question is resolved and closed to new messages.' : errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  async createQuestion(): Promise<void> {
    const title = this.newTitle.trim();
    const body = this.newBody.trim();
    if (!title || !body) {
      this.error.set('A title and a first message are required.');
      return;
    }
    try {
      const created = await this.api.create(this.projectId(), title, body);
      this.newTitle = '';
      this.newBody = '';
      await this.loadList();
      await this.router.navigate(['/projects', this.projectId(), 'questions', created.id]);
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }
}
