import { Component, DestroyRef, NgZone, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  ListedChannel,
  UnreadChangedEvent,
  UnreadMessageIndicatorsApiService,
} from './unread-message-indicators-api.service';

interface Row { id: string; name: string; kind: 'general' | 'question'; internal_only: boolean }

/** /projects/:id/channels — channel list with live unread bubbles. */
@Component({
  selector: 'app-unread-channel-list',
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="ucl" data-testid="unread-channel-page">
      <a [routerLink]="['/projects', projectId()]">Back to project</a>
      <h1>Channels</h1>
      @if (error(); as e) { <div class="error" role="alert" data-testid="unread-error">{{ e }}</div> }
      <ul class="ucl-list" data-testid="unread-channel-list">
        @for (c of rows(); track c.id) {
          <li data-testid="unread-channel-item" [attr.data-channel-id]="c.id">
            <a href="" (click)="open(c, $event)" data-testid="unread-channel-link">
              {{ c.kind === 'general' ? '# ' : '' }}{{ c.name }}
            </a>
            @if (c.internal_only) { <span class="tag">internal</span> }
            @if (count(c.id) > 0) {
              <span class="bubble" data-testid="unread-bubble" [attr.aria-label]="count(c.id) + ' unread'">{{ count(c.id) }}</span>
            }
          </li>
        } @empty {
          @if (!loading()) { <li class="muted">No channels yet</li> }
        }
      </ul>
    </div>
  `,
  styles: [
    `
      .ucl { padding: 1rem; max-width: 40rem; }
      .ucl-list { list-style: none; padding: 0; }
      .ucl-list li { display: flex; align-items: center; gap: 0.5rem; padding: 0.35rem 0; }
      .bubble { min-width: 1.4em; padding: 0 0.4em; border-radius: 999px; background: #d93025; color: #fff; font-size: 0.8em; text-align: center; }
      .tag { font-size: 0.75em; opacity: 0.7; }
      .muted { opacity: 0.6; }
      .error { color: #b00020; }
    `,
  ],
})
export class UnreadChannelListComponent implements OnInit {
  private api = inject(UnreadMessageIndicatorsApiService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private zone = inject(NgZone);
  private destroyRef = inject(DestroyRef);

  readonly projectId = signal('');
  readonly rows = signal<Row[]>([]);
  readonly counts = signal<Record<string, number>>({});
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  /** Channel currently being opened/viewed; its events never raise the bubble. */
  private viewing: string | null = null;
  private stream: EventSource | null = null;

  /** Stored unread count for a channel (0 when unknown). */
  count(id: string): number {
    return this.counts()[id] ?? 0;
  }

  ngOnInit(): void {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((p) => {
      this.projectId.set(p.get('id') ?? '');
      void this.load();
    });
    this.openStream();
    this.destroyRef.onDestroy(() => this.stream?.close());
  }

  private async load(): Promise<void> {
    const id = this.projectId();
    this.loading.set(true);
    this.error.set(null);
    try {
      const [list, unread] = await Promise.all([this.api.channels(id), this.api.unread(id)]);
      const toRow = (kind: Row['kind']) => (c: ListedChannel): Row => ({
        id: c.id, name: c.name ?? '', kind, internal_only: c.internal_only === true,
      });
      this.rows.set([...(list?.general ?? []).map(toRow('general')), ...(list?.questions ?? []).map(toRow('question'))]);
      const next: Record<string, number> = {};
      for (const c of unread?.counts ?? []) next[c.channel_id] = Math.max(0, Math.floor(Number(c.unread_count) || 0));
      this.counts.set(next);
    } catch (err) {
      const status = (err as { status?: number })?.status;
      this.error.set(status === 403 ? 'You do not have access to this project.' : 'Could not load channels.');
    } finally {
      this.loading.set(false);
    }
  }

  private openStream(): void {
    const es = this.api.openStream();
    if (!es) return;
    this.stream = es;
    es.addEventListener('unread.changed', (e: Event) => {
      const data = (e as MessageEvent).data;
      this.zone.run(() => this.applyEvent(typeof data === 'string' ? safeParse(data) : data));
    });
  }

  /** Applies an unread.changed event: stored count when given, else N -> N+1. */
  applyEvent(event: UnreadChangedEvent | null): void {
    if (!event?.channel_id) return;
    const pid = event.payload?.project_id;
    if (pid && pid !== this.projectId()) return;
    const id = event.channel_id;
    if (id === this.viewing) return;
    const stored = event.payload?.unread_count;
    this.counts.update((c) => ({
      ...c,
      [id]: typeof stored === 'number' && Number.isFinite(stored) ? Math.max(0, Math.floor(stored)) : (c[id] ?? 0) + 1,
    }));
  }

  async open(c: Row, ev?: Event): Promise<void> {
    ev?.preventDefault();
    this.viewing = c.id;
    this.counts.update((m) => ({ ...m, [c.id]: 0 }));
    try {
      await this.api.markRead(c.id);
    } catch {
      /* navigation still proceeds; the channel page reloads counts later */
    }
    const section = c.kind === 'question' ? 'questions' : 'channels';
    await this.router.navigate(['/projects', this.projectId(), section, c.id]);
  }
}

function safeParse(s: string): UnreadChangedEvent | null {
  try {
    return JSON.parse(s) as UnreadChangedEvent;
  } catch {
    return null;
  }
}
