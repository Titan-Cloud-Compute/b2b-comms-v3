import { Component, DestroyRef, NgZone, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../shared/auth.service';
import { GeneralChannelsApiService, errorMessage } from '../general-channels/general-channels-api.service';
import { UnreadChangedPayload, UnreadMessageIndicatorsApiService } from './unread-message-indicators-api.service';

interface UnreadChannelRow { id: string; name: string; kind: 'general' | 'question'; internal_only: boolean; unread_count: number }

/** Channel list for a project with an unread bubble beside each channel (Story: Unread Message Indicators). */
@Component({
  selector: 'app-unread-channel-list',
  standalone: true,
  imports: [RouterLink],
  template: `
    <section class="ucl" data-testid="unread-channel-list-page">
      <a [routerLink]="['/projects', projectId()]">Back to project</a>
      <h1>Channels</h1>
      @if (error(); as e) {
        <div class="error" role="alert" data-testid="unread-error">{{ e }}</div>
      } @else if (loading()) {
        <p class="muted" data-testid="unread-loading">Loading channels…</p>
      } @else {
        <ul class="ucl-list" data-testid="unread-channel-list">
          @for (c of rows(); track c.id) {
            <li data-testid="unread-channel-item" [attr.data-channel-id]="c.id">
              <a href="" (click)="open(c, $event)" data-testid="unread-channel-link">
                {{ c.kind === 'general' ? '# ' : '' }}{{ c.name }}
              </a>
              @if (c.internal_only) { <span class="tag">internal</span> }
              @if (c.unread_count > 0) {
                <span class="bubble" data-testid="unread-bubble" [attr.aria-label]="c.unread_count + ' unread'">{{ c.unread_count }}</span>
              }
            </li>
          } @empty {
            <li class="muted" data-testid="unread-empty">No channels yet</li>
          }
        </ul>
      }
    </section>
  `,
  styles: [`
    .ucl-list { list-style: none; padding: 0; }
    .ucl-list li { display: flex; align-items: center; gap: 0.5rem; padding: 0.35rem 0; }
    .bubble { min-width: 1.4em; padding: 0 0.4em; border-radius: 999px; background: #d93025; color: #fff; font-size: 0.8em; text-align: center; }
    .tag, .muted { color: #666; font-size: 0.85em; }
    .error { color: #b00020; }
  `],
})
export class UnreadChannelListComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private zone = inject(NgZone);
  private auth = inject(AuthService);
  private channelsApi = inject(GeneralChannelsApiService);
  private api = inject(UnreadMessageIndicatorsApiService);
  private streams: EventSource[] = [];

  projectId = signal('');
  rows = signal<UnreadChannelRow[]>([]);
  loading = signal(true);
  error = signal<string | null>(null);

  constructor() {
    inject(DestroyRef).onDestroy(() => this.closeStreams());
  }

  ngOnInit(): void {
    this.projectId.set(this.route.snapshot.paramMap.get('id') ?? '');
    void this.load();
  }

  private async load(): Promise<void> {
    const projectId = this.projectId();
    this.loading.set(true);
    this.error.set(null);
    try {
      const [list, unread] = await Promise.all([this.channelsApi.channels(projectId), this.api.unread(projectId)]);
      const counts = new Map((unread?.counts ?? []).map((c) => [c.channel_id, Number(c.unread_count) || 0]));
      const rows: UnreadChannelRow[] = [
        ...(list?.general ?? []).map((c) => ({ id: c.id, name: c.name, kind: 'general' as const, internal_only: !!c.internal_only, unread_count: 0 })),
        ...(list?.questions ?? []).map((q) => ({ id: q.id, name: q.name, kind: 'question' as const, internal_only: false, unread_count: 0 })),
      ].map((r) => ({ ...r, unread_count: counts.get(r.id) ?? 0 }));
      this.rows.set(rows);
      this.subscribe(rows.map((r) => r.id));
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }

  private subscribe(channelIds: string[]): void {
    this.closeStreams();
    for (const id of channelIds) {
      const es = this.api.openStream(id);
      if (!es) continue;
      es.addEventListener('unread.changed', (ev: Event) => this.zone.run(() => this.onUnreadChanged(id, ev as MessageEvent)));
      this.streams.push(es);
    }
  }

  private onUnreadChanged(streamChannelId: string, ev: MessageEvent): void {
    let event: { channel_id?: string; payload?: UnreadChangedPayload } = {};
    try {
      event = JSON.parse(String(ev.data ?? '{}'));
    } catch {
      return;
    }
    const channelId = event.channel_id ?? streamChannelId;
    const payload = event.payload ?? {};
    const me = this.auth.user()?.id;
    if (payload.user_id && me && payload.user_id !== me) return;
    this.rows.update((rows) =>
      rows.map((r) =>
        r.id === channelId
          ? { ...r, unread_count: typeof payload.unread_count === 'number' ? payload.unread_count : r.unread_count + 1 }
          : r,
      ),
    );
  }

  async open(row: UnreadChannelRow, ev?: Event): Promise<void> {
    ev?.preventDefault();
    try {
      await this.api.markRead(row.id);
    } catch {
      /* opening the channel still works; the server re-syncs on next load */
    }
    this.rows.update((rows) => rows.map((r) => (r.id === row.id ? { ...r, unread_count: 0 } : r)));
    const segment = row.kind === 'question' ? 'questions' : 'channels';
    void this.router.navigate(['/projects', this.projectId(), segment, row.id]);
  }

  private closeStreams(): void {
    for (const es of this.streams) es.close();
    this.streams = [];
  }
}
