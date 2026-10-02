import { Component, DestroyRef, ElementRef, NgZone, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AuthService } from '../../shared/auth.service';
import {
  ChannelList,
  ChannelMessage,
  GeneralChannelsApiService,
  RealtimeEvent,
  errorMessage,
  errorStatus,
} from './general-channels-api.service';

interface PendingMessage { tempId: string; channelId: string; body_html: string; file_ids: string[]; attachments: { file_id: string; name: string }[] }

let tempSeq = 0;

@Component({
  selector: 'app-general-channel',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <div class="gc" data-testid="general-channel-page">
      <aside class="gc-sidebar">
        <a [routerLink]="['/projects', projectId()]">Back to project</a>
        <section data-testid="general-channels-section" aria-labelledby="gc-general-heading">
          <h2 id="gc-general-heading">General Channels</h2>
          <ul class="gc-channels">
            @for (c of channels().general; track c.id) {
              <li [class.active]="c.id === channelId()" data-testid="general-channel-item">
                <a [routerLink]="['/projects', projectId(), 'channels', c.id]"># {{ c.name }}</a>
                @if (c.internal_only) { <span class="tag">internal</span> }
                @if (c.unread_count > 0) { <span class="badge">{{ c.unread_count }}</span> }
              </li>
            } @empty {
              @if (!loadingChannels()) { <li class="muted">No channels yet</li> }
            }
          </ul>
          @if (canCreate()) {
            <form class="gc-new" (ngSubmit)="createChannel()" data-testid="create-channel-form">
              <input name="newName" placeholder="New channel name" [(ngModel)]="newName" data-testid="create-channel-name" />
              <label><input type="checkbox" name="newInternal" [(ngModel)]="newInternal" data-testid="create-channel-internal" /> Internal only</label>
              <button type="submit" [disabled]="!newName.trim()" data-testid="create-channel-submit">Create channel</button>
            </form>
          }
        </section>
        @if (channels().questions.length) {
          <section data-testid="question-channels-section">
            <h2>Active Questions</h2>
            <ul class="gc-channels">
              @for (q of channels().questions; track q.id) {
                <li><a [routerLink]="['/projects', projectId(), 'questions', q.id]">{{ q.name }}</a></li>
              }
            </ul>
          </section>
        }
      </aside>

      <main class="gc-main">
        <h1># {{ currentName() }}</h1>
        @if (error(); as e) { <div class="error" role="alert" data-testid="channel-error">{{ e }}</div> }
        @if (!online()) { <div class="offline" data-testid="offline-banner">You are offline — messages will be sent when the connection returns.</div> }

        <div class="gc-messages" data-testid="message-list" aria-live="polite">
          @if (nextCursor()) {
            <button type="button" (click)="loadOlder()" data-testid="load-older">Load older messages</button>
          }
          @for (m of messages(); track m.id) {
            <article class="gc-msg" data-testid="message" [attr.data-message-id]="m.id">
              <header>
                <strong>{{ m.author.display_name }}</strong>
                <time>{{ m.created_at ? m.created_at.slice(0, 16).replace('T', ' ') : '' }}</time>
                @if (m.edited_at) { <span class="edited" data-testid="message-edited">(edited)</span> }
              </header>
              @if (editingId() === m.id) {
                <div class="gc-input" contenteditable="true" #editBox [innerHTML]="m.body_html" data-testid="message-edit-input"></div>
                <button type="button" (click)="saveEdit(m, editBox.innerHTML)" data-testid="message-edit-save">Save</button>
                <button type="button" (click)="editingId.set(null)">Cancel</button>
              } @else {
                <div class="gc-body" data-testid="message-body" [innerHTML]="m.body_html"></div>
              }
              @if (m.attachments.length) {
                <ul class="gc-atts">
                  @for (a of m.attachments; track a.file_id) { <li data-testid="message-attachment">📎 {{ a.name }}</li> }
                </ul>
              }
              @if (isMine(m) && editingId() !== m.id) {
                <div class="gc-actions">
                  <button type="button" (click)="editingId.set(m.id)" data-testid="message-edit">Edit</button>
                  <button type="button" (click)="remove(m)" data-testid="message-delete">Delete</button>
                </div>
              }
            </article>
          } @empty {
            @if (!loadingMessages() && !pendingHere().length) { <p class="muted" data-testid="message-empty">No messages yet.</p> }
          }
          @for (p of pendingHere(); track p.tempId) {
            <article class="gc-msg pending" data-testid="message-pending">
              <header><strong>{{ myName() }}</strong> <span class="pending-label">pending</span></header>
              <div class="gc-body" [innerHTML]="p.body_html"></div>
            </article>
          }
        </div>

        <form class="gc-composer" data-testid="message-composer" (ngSubmit)="send()">
          <div class="gc-toolbar" role="toolbar" aria-label="Formatting">
            <button type="button" (mousedown)="$event.preventDefault()" (click)="format('bold')" data-testid="composer-bold" aria-label="Bold"><b>B</b></button>
            <button type="button" (mousedown)="$event.preventDefault()" (click)="format('italic')" data-testid="composer-italic" aria-label="Italic"><i>I</i></button>
            <button type="button" (mousedown)="$event.preventDefault()" (click)="format('insertUnorderedList')" data-testid="composer-list" aria-label="Bulleted list">• List</button>
            <button type="button" (mousedown)="$event.preventDefault()" (click)="format('insertOrderedList')" aria-label="Numbered list">1. List</button>
            <button type="button" (mousedown)="$event.preventDefault()" (click)="addLink()" data-testid="composer-link" aria-label="Link">Link</button>
            <label class="gc-attach">📎 Attach
              <input type="file" multiple (change)="onFiles($event)" data-testid="composer-attach" />
            </label>
          </div>
          <div #editor class="gc-input" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Message"
               data-testid="composer-input" (keydown.enter)="onEnter($any($event))"></div>
          @if (attachments().length) {
            <ul class="gc-atts" data-testid="composer-attachments">
              @for (a of attachments(); track a.file_id) {
                <li>📎 {{ a.name }} <button type="button" (click)="removeAttachment(a.file_id)" aria-label="Remove attachment">×</button></li>
              }
            </ul>
          }
          <button type="submit" data-testid="composer-send" [disabled]="uploading()">Send</button>
        </form>
      </main>
    </div>
  `,
  styles: [`
    .gc { display: flex; gap: 1rem; min-height: 70vh; }
    .gc-sidebar { width: 240px; flex-shrink: 0; }
    .gc-channels { list-style: none; padding: 0; }
    .gc-channels li.active a { font-weight: 600; }
    .gc-main { flex: 1; display: flex; flex-direction: column; min-width: 0; }
    .gc-messages { flex: 1; overflow-y: auto; }
    .gc-msg { padding: 0.5rem 0; border-bottom: 1px solid #eee; }
    .gc-msg.pending { opacity: 0.6; }
    .pending-label, .edited, .tag, .muted { color: #666; font-size: 0.85em; }
    .gc-input { border: 1px solid #ccc; border-radius: 4px; min-height: 3rem; padding: 0.5rem; }
    .gc-attach input { display: none; }
    .error { color: #b00020; }
    .badge { background: #d33; color: #fff; border-radius: 999px; padding: 0 0.4rem; font-size: 0.8em; }
  `],
})
export class ChannelComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private api = inject(GeneralChannelsApiService);
  private auth = inject(AuthService);
  private destroyRef = inject(DestroyRef);
  private zone = inject(NgZone);

  @ViewChild('editor') editor?: ElementRef<HTMLDivElement>;

  projectId = signal('');
  channelId = signal('');
  channels = signal<ChannelList>({ general: [], questions: [] });
  messages = signal<ChannelMessage[]>([]);
  nextCursor = signal<string | null>(null);
  pending = signal<PendingMessage[]>([]);
  attachments = signal<{ file_id: string; name: string }[]>([]);
  error = signal<string | null>(null);
  online = signal(typeof navigator === 'undefined' ? true : navigator.onLine);
  loadingChannels = signal(false);
  loadingMessages = signal(false);
  uploading = signal(false);
  editingId = signal<string | null>(null);
  newName = '';
  newInternal = false;

  private stream: EventSource | null = null;
  private flushing = false;

  private me = computed(() => this.auth.user() as unknown as { id?: string; role?: string; name?: string; email?: string } | null);
  myName = computed(() => this.me()?.name || this.me()?.email || 'You');
  canCreate = computed(() => ['ADMIN', 'MANAGER'].includes(String(this.me()?.role ?? '').toUpperCase()));
  pendingHere = computed(() => this.pending().filter((p) => p.channelId === this.channelId()));
  currentName = computed(() => this.channels().general.find((c) => c.id === this.channelId())?.name ?? 'general');

  ngOnInit(): void {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const pid = params.get('id') ?? '';
      const cid = params.get('channelId') ?? '';
      const projectChanged = pid !== this.projectId();
      this.projectId.set(pid);
      this.channelId.set(cid);
      this.editingId.set(null);
      if (projectChanged) void this.loadChannels();
      void this.loadMessages();
      this.openStream();
    });

    const onOnline = () => this.zone.run(() => {
      this.online.set(true);
      void this.reconnected();
    });
    const onOffline = () => this.zone.run(() => this.online.set(false));
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    this.destroyRef.onDestroy(() => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      this.stream?.close();
    });
  }

  async loadChannels(): Promise<void> {
    this.loadingChannels.set(true);
    try {
      this.channels.set(await this.api.channels(this.projectId()));
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loadingChannels.set(false);
    }
  }

  async loadMessages(): Promise<void> {
    const cid = this.channelId();
    this.loadingMessages.set(true);
    try {
      const page = await this.api.messages(cid);
      if (cid !== this.channelId()) return;
      this.messages.set([...page.items].reverse());
      this.nextCursor.set(page.next_cursor);
      this.error.set(null);
    } catch (e) {
      if (cid !== this.channelId()) return;
      this.messages.set([]);
      this.nextCursor.set(null);
      this.error.set(errorStatus(e) === 403 ? 'You do not have access to this channel.' : errorMessage(e));
    } finally {
      this.loadingMessages.set(false);
    }
  }

  async loadOlder(): Promise<void> {
    const cursor = this.nextCursor();
    if (!cursor) return;
    try {
      const page = await this.api.messages(this.channelId(), cursor);
      const known = new Set(this.messages().map((m) => m.id));
      this.messages.set([...[...page.items].reverse().filter((m) => !known.has(m.id)), ...this.messages()]);
      this.nextCursor.set(page.next_cursor);
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }

  private openStream(): void {
    this.stream?.close();
    const stream = this.api.openStream(this.channelId());
    this.stream = stream;
    if (!stream) return;
    let first = true;
    stream.addEventListener('ready', () => this.zone.run(() => {
      // Initial connect is already covered by loadMessages(); a later "ready" is a reconnect.
      if (!first) void this.reconnected();
      first = false;
    }));
    const handle = (ev: MessageEvent) => this.zone.run(() => {
      try {
        this.applyEvent(JSON.parse(ev.data) as RealtimeEvent);
      } catch { /* ignore malformed frames */ }
    });
    for (const t of ['message.created', 'message.updated', 'message.deleted']) {
      stream.addEventListener(t, handle as EventListener);
    }
  }

  applyEvent(ev: RealtimeEvent): void {
    if (ev.channel_id !== this.channelId()) return;
    if (ev.type === 'message.created') {
      const m = ev.payload as ChannelMessage;
      if (!this.messages().some((x) => x.id === m.id)) this.messages.update((list) => [...list, m]);
    } else if (ev.type === 'message.updated') {
      const u = ev.payload as { id: string; body_html: string; edited_at: string };
      this.messages.update((list) => list.map((m) => (m.id === u.id ? { ...m, body_html: u.body_html, edited_at: u.edited_at } : m)));
    } else if (ev.type === 'message.deleted') {
      const id = (ev.payload as { id: string }).id;
      this.messages.update((list) => list.filter((m) => m.id !== id));
    }
  }

  /** Connection is back: resend pending messages, then fetch what was missed. */
  async reconnected(): Promise<void> {
    await this.flushPending();
    await this.loadMessages();
  }

  format(command: 'bold' | 'italic' | 'insertUnorderedList' | 'insertOrderedList'): void {
    this.editor?.nativeElement.focus();
    document.execCommand(command, false);
  }

  addLink(): void {
    const url = window.prompt('Link URL');
    if (!url || !/^(https?:|mailto:)/i.test(url.trim())) return;
    this.editor?.nativeElement.focus();
    document.execCommand('createLink', false, url.trim());
  }

  onEnter(ev: KeyboardEvent): void {
    if (ev.shiftKey) return;
    ev.preventDefault();
    void this.send();
  }

  async onFiles(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (!files.length) return;
    this.uploading.set(true);
    try {
      for (const f of files) {
        const up = await this.api.uploadAttachment(this.projectId(), f);
        this.attachments.update((a) => [...a, { file_id: up.id, name: up.name }]);
      }
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.uploading.set(false);
    }
  }

  removeAttachment(fileId: string): void {
    this.attachments.update((a) => a.filter((x) => x.file_id !== fileId));
  }

  async send(): Promise<void> {
    const el = this.editor?.nativeElement;
    const html = (el?.innerHTML ?? '').trim();
    const text = (el?.textContent ?? '').replace(/ /g, ' ').trim();
    const atts = this.attachments();
    if (!text && !atts.length) {
      this.error.set('Message cannot be empty.');
      return;
    }
    const p: PendingMessage = {
      tempId: `tmp-${++tempSeq}`,
      channelId: this.channelId(),
      body_html: html,
      file_ids: atts.map((a) => a.file_id),
      attachments: atts,
    };
    if (el) el.innerHTML = '';
    this.attachments.set([]);
    this.error.set(null);
    this.pending.update((list) => [...list, p]);
    if (!this.online()) return;
    await this.deliver(p);
  }

  /** Try to send one pending message; it stays pending on network failure. */
  private async deliver(p: PendingMessage): Promise<boolean> {
    try {
      const res = await this.api.send(p.channelId, p.body_html, p.file_ids);
      this.pending.update((list) => list.filter((x) => x.tempId !== p.tempId));
      if (p.channelId === this.channelId() && !this.messages().some((m) => m.id === res.id)) {
        this.messages.update((list) => [
          ...list,
          {
            id: res.id,
            channel_id: res.channel_id,
            author: { id: res.author_id, display_name: this.myName() },
            body_html: res.body_html,
            attachments: p.attachments,
            reference_id: null,
            edited_at: null,
            created_at: res.created_at,
          },
        ]);
      }
      return true;
    } catch (e) {
      const status = errorStatus(e);
      if (status === 0 || status >= 500) return false; // keep pending; retried on reconnect
      this.pending.update((list) => list.filter((x) => x.tempId !== p.tempId));
      this.error.set(errorMessage(e));
      return true;
    }
  }

  async flushPending(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      for (const p of [...this.pending()]) {
        if (!(await this.deliver(p))) break;
      }
    } finally {
      this.flushing = false;
    }
  }

  isMine(m: ChannelMessage): boolean {
    const id = this.me()?.id;
    return !!id && m.author?.id === id;
  }

  async saveEdit(m: ChannelMessage, html: string): Promise<void> {
    try {
      const res = await this.api.edit(m.id, html);
      this.messages.update((list) => list.map((x) => (x.id === m.id ? { ...x, body_html: res.body_html, edited_at: res.edited_at } : x)));
      this.editingId.set(null);
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }

  async remove(m: ChannelMessage): Promise<void> {
    if (!window.confirm('Delete this message?')) return;
    try {
      await this.api.remove(m.id);
      this.messages.update((list) => list.filter((x) => x.id !== m.id));
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }

  async createChannel(): Promise<void> {
    const name = this.newName.trim();
    if (!name) return;
    try {
      await this.api.createChannel(this.projectId(), name, this.newInternal);
      this.newName = '';
      this.newInternal = false;
      await this.loadChannels();
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }
}
