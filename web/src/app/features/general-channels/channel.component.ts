import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { AuthService } from '../../shared/auth.service';
import {
  Channel,
  ChannelMessage,
  ChannelsApi,
  REALTIME_SOCKET_URL,
  RealtimeEnvelope,
} from './channels.api';

interface PendingMessage {
  localId: string;
  channelId: string;
  bodyHtml: string;
  createdAt: string;
}

function isBlankHtml(html: string): boolean {
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;| /g, ' ').trim().length === 0;
}

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

function isNetworkError(e: unknown): boolean {
  return isOffline() || (e as { status?: number } | null)?.status === 0;
}

@Component({
  selector: 'app-channel',
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="channel-page" data-testid="channel-page">
      <aside class="channel-list" data-testid="channel-list">
        <a [routerLink]="['/projects', projectId()]">← Project</a>
        <h2 data-testid="general-channels-heading">General Channels</h2>
        @if (channelsError()) {
          <p role="alert" data-testid="channels-error">{{ channelsError() }}</p>
        }
        <ul>
          @for (c of channels(); track c.id) {
            <li>
              <a data-testid="channel-link"
                 [class.active]="c.id === channelId()"
                 [routerLink]="['/projects', projectId(), 'channels', c.id]"># {{ c.name }}</a>
              @if (c.internalOnly) { <span class="tag" data-testid="channel-internal">internal</span> }
            </li>
          }
        </ul>
        @if (canCreate()) {
          <form class="new-channel" (submit)="$event.preventDefault(); createChannel(nameInput, internalInput)">
            <input #nameInput data-testid="new-channel-name" placeholder="New channel name" />
            <label><input #internalInput type="checkbox" data-testid="new-channel-internal" /> Internal only</label>
            <button type="submit" data-testid="create-channel">Create channel</button>
            @if (createError()) { <p role="alert" data-testid="create-channel-error">{{ createError() }}</p> }
          </form>
        }
      </aside>

      <section class="channel-main">
        <h1 data-testid="channel-title"># {{ currentChannel()?.name || 'channel' }}</h1>
        @if (error()) {
          <p role="alert" data-testid="channel-error">{{ error() }}</p>
        }
        <ol class="message-list" data-testid="message-list">
          @for (m of messages(); track m.id) {
            <li class="message" data-testid="message" [attr.data-message-id]="m.id">
              <strong class="author">{{ m.authorName || 'Someone' }}</strong>
              @if (m.deletedAt) {
                <em class="muted" data-testid="message-removed">Message removed</em>
              } @else if (editingId() === m.id) {
                <div #editBox class="editor" contenteditable="true" data-testid="edit-input" [innerHTML]="m.bodyHtml"></div>
                <button type="button" data-testid="save-edit" (click)="saveEdit(m, editBox.innerHTML)">Save</button>
                <button type="button" (click)="editingId.set(null)">Cancel</button>
              } @else {
                <div class="body" data-testid="message-body" [innerHTML]="m.bodyHtml"></div>
                @if (m.editedAt) { <span class="muted" data-testid="message-edited">(edited)</span> }
                @if (m.authorId === myId()) {
                  <button type="button" data-testid="edit-message" (click)="editingId.set(m.id)">Edit</button>
                  <button type="button" data-testid="delete-message" (click)="remove(m)">Delete</button>
                }
              }
            </li>
          }
          @for (p of pendingForChannel(); track p.localId) {
            <li class="message pending" data-testid="message">
              <strong class="author">{{ myName() }}</strong>
              <div class="body" data-testid="message-body" [innerHTML]="p.bodyHtml"></div>
              <span class="muted" data-testid="message-pending">pending</span>
            </li>
          }
        </ol>

        <div class="composer">
          <div class="toolbar">
            <button type="button" data-testid="format-bold" (mousedown)="$event.preventDefault(); format('bold')"><b>B</b></button>
            <button type="button" data-testid="format-italic" (mousedown)="$event.preventDefault(); format('italic')"><i>I</i></button>
            <button type="button" data-testid="format-list" (mousedown)="$event.preventDefault(); format('insertUnorderedList')">• List</button>
            <button type="button" data-testid="format-numbered" (mousedown)="$event.preventDefault(); format('insertOrderedList')">1. List</button>
            <button type="button" data-testid="format-link" (mousedown)="$event.preventDefault(); format('createLink')">Link</button>
          </div>
          <div #composer class="editor" contenteditable="true" data-testid="composer"
               aria-label="Message" (keydown.enter)="onEnter($event, composer)"></div>
          <button type="button" data-testid="send-message" (click)="send(composer)">Send</button>
          @if (composerError()) { <p role="alert" data-testid="composer-error">{{ composerError() }}</p> }
        </div>
      </section>
    </div>
  `,
  styles: [`
    .channel-page { display: flex; gap: 1rem; padding: 2rem 1rem; max-width: 1100px; margin: 0 auto; }
    .channel-list { flex: 0 0 220px; border: 1px solid var(--color-border); border-radius: 8px; padding: 1rem; }
    .channel-list ul { list-style: none; padding: 0; }
    .channel-list a.active { font-weight: bold; }
    .channel-main { flex: 1; display: flex; flex-direction: column; gap: 0.5rem; }
    .message-list { list-style: none; padding: 0; display: flex; flex-direction: column; gap: 0.5rem; }
    .message { border: 1px solid var(--color-border); border-radius: 8px; padding: 0.5rem; }
    .editor { min-height: 3rem; border: 1px solid var(--color-border); border-radius: 8px; padding: 0.5rem; }
    .muted, .tag { opacity: 0.7; }
  `],
})
export class ChannelComponent implements OnInit, OnDestroy {
  private api = inject(ChannelsApi);
  private route = inject(ActivatedRoute);
  private auth = inject(AuthService);

  projectId = signal('');
  channelId = signal('');
  channels = signal<Channel[]>([]);
  messages = signal<ChannelMessage[]>([]);
  pending = signal<PendingMessage[]>([]);
  error = signal<string | null>(null);
  channelsError = signal<string | null>(null);
  createError = signal<string | null>(null);
  composerError = signal<string | null>(null);
  editingId = signal<string | null>(null);

  myId = computed(() => this.auth.user()?.id ?? '');
  myName = computed(() => this.auth.user()?.name ?? 'You');
  canCreate = computed(() => {
    const role = this.auth.user()?.role;
    return role === 'ADMIN' || role === 'MANAGER' || role === 'SUPER_ADMIN';
  });
  currentChannel = computed(() => this.channels().find((c) => c.id === this.channelId()) ?? null);
  pendingForChannel = computed(() => this.pending().filter((p) => p.channelId === this.channelId()));

  private sub?: Subscription;
  private socket?: EventSource;
  private seq = 0;
  private flushing = false;
  private readonly onOnline = () => void this.flushPending();

  ngOnInit(): void {
    this.sub = this.route.paramMap.subscribe((params) => {
      const projectId = params.get('id') ?? '';
      const channelId = params.get('channelId') ?? '';
      const projectChanged = projectId !== this.projectId();
      this.projectId.set(projectId);
      this.channelId.set(channelId);
      this.editingId.set(null);
      if (projectChanged) void this.loadChannels();
      void this.loadMessages();
    });
    if (typeof window !== 'undefined') window.addEventListener('online', this.onOnline);
    this.openSocket();
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
    this.socket?.close();
    if (typeof window !== 'undefined') window.removeEventListener('online', this.onOnline);
  }

  async loadChannels(): Promise<void> {
    try {
      this.channels.set(await this.api.listChannels(this.projectId()));
      this.channelsError.set(null);
    } catch {
      this.channelsError.set('Channels could not be loaded.');
    }
  }

  async loadMessages(): Promise<void> {
    const channelId = this.channelId();
    try {
      const list = await this.api.listMessages(channelId);
      if (channelId !== this.channelId()) return;
      // Keep live-pushed messages that arrived while this fetch was in flight.
      const fetched = new Set(list.map((m) => m.id));
      const live = this.messages().filter((m) => m.channelId === channelId && !fetched.has(m.id));
      this.messages.set([...list, ...live].sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
      this.error.set(null);
    } catch (e) {
      if (channelId !== this.channelId()) return;
      this.messages.set([]);
      const status = (e as { status?: number } | null)?.status;
      this.error.set(status === 403 ? 'You do not have access to this channel.' : 'Messages could not be loaded.');
    }
  }

  async createChannel(nameInput: HTMLInputElement, internalInput: HTMLInputElement): Promise<void> {
    const name = nameInput.value.trim();
    if (!name) {
      this.createError.set('Channel name is required.');
      return;
    }
    try {
      const created = await this.api.createChannel(this.projectId(), name, internalInput.checked);
      this.upsertChannel(created);
      nameInput.value = '';
      internalInput.checked = false;
      this.createError.set(null);
    } catch (e) {
      const status = (e as { status?: number } | null)?.status;
      this.createError.set(status === 403 ? 'Only managers and admins can create channels.' : 'Channel could not be created.');
    }
  }

  format(command: string): void {
    if (typeof document === 'undefined') return;
    if (command === 'createLink') {
      const url = window.prompt('Link URL');
      if (!url) return;
      document.execCommand('createLink', false, url);
      return;
    }
    document.execCommand(command, false);
  }

  onEnter(event: Event, composer: HTMLElement): void {
    const e = event as KeyboardEvent;
    if (e.shiftKey) return;
    e.preventDefault();
    void this.send(composer);
  }

  async send(composer: HTMLElement): Promise<void> {
    const bodyHtml = composer.innerHTML;
    if (isBlankHtml(bodyHtml)) {
      this.composerError.set('Message cannot be empty.');
      return;
    }
    this.composerError.set(null);
    composer.innerHTML = '';
    const pending: PendingMessage = {
      localId: `pending-${++this.seq}`,
      channelId: this.channelId(),
      bodyHtml,
      createdAt: new Date().toISOString(),
    };
    if (isOffline()) {
      this.pending.update((list) => [...list, pending]);
      return;
    }
    try {
      this.upsertMessage(await this.api.postMessage(pending.channelId, bodyHtml));
    } catch (e) {
      if (isNetworkError(e)) {
        this.pending.update((list) => [...list, pending]);
      } else {
        composer.innerHTML = bodyHtml;
        this.composerError.set('Message could not be sent.');
      }
    }
  }

  /** Retry queued messages after reconnecting, then refetch whatever was missed. */
  async flushPending(): Promise<void> {
    if (this.flushing || isOffline()) return;
    this.flushing = true;
    try {
      for (const p of [...this.pending()]) {
        try {
          const saved = await this.api.postMessage(p.channelId, p.bodyHtml);
          this.pending.update((list) => list.filter((x) => x.localId !== p.localId));
          if (saved.channelId === this.channelId()) this.upsertMessage(saved);
        } catch (e) {
          if (isNetworkError(e)) break;
          this.pending.update((list) => list.filter((x) => x.localId !== p.localId));
        }
      }
    } finally {
      this.flushing = false;
    }
    if (!this.socket || this.socket.readyState === 2) this.openSocket();
    await this.loadMessages();
  }

  async saveEdit(m: ChannelMessage, bodyHtml: string): Promise<void> {
    if (isBlankHtml(bodyHtml)) {
      this.error.set('Message cannot be empty.');
      return;
    }
    try {
      this.upsertMessage(await this.api.editMessage(m.id, bodyHtml));
      this.editingId.set(null);
      this.error.set(null);
    } catch {
      this.error.set('Message could not be edited.');
    }
  }

  async remove(m: ChannelMessage): Promise<void> {
    try {
      await this.api.deleteMessage(m.id);
      this.upsertMessage({ ...m, bodyHtml: '', attachments: [], deletedAt: new Date().toISOString() });
    } catch {
      this.error.set('Message could not be deleted.');
    }
  }

  private upsertChannel(c: Channel): void {
    if (c.projectId && c.projectId !== this.projectId()) return;
    if (c.kind && c.kind !== 'general') return;
    this.channels.update((list) => (list.some((x) => x.id === c.id) ? list.map((x) => (x.id === c.id ? c : x)) : [...list, c]));
  }

  private upsertMessage(m: ChannelMessage): void {
    if (m.channelId && m.channelId !== this.channelId()) return;
    this.messages.update((list) => {
      const next = list.some((x) => x.id === m.id) ? list.map((x) => (x.id === m.id ? m : x)) : [...list, m];
      return next.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    });
  }

  private openSocket(): void {
    if (typeof EventSource === 'undefined') return;
    this.socket?.close();
    const socket = new EventSource(REALTIME_SOCKET_URL, { withCredentials: true });
    this.socket = socket;
    const handle = (raw: MessageEvent) => {
      let event: RealtimeEnvelope;
      try {
        event = JSON.parse(raw.data) as RealtimeEnvelope;
      } catch {
        return;
      }
      if (event.type === 'channel.created') {
        this.upsertChannel(event.payload as Channel);
      } else if (event.channelId === this.channelId()) {
        this.upsertMessage(event.payload as ChannelMessage);
      }
    };
    for (const type of ['message.created', 'message.updated', 'message.deleted', 'channel.created']) {
      socket.addEventListener(type, handle as EventListener);
    }
  }
}
