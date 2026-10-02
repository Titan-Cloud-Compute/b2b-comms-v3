import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  MessageReferenceApiService,
  ReferenceView,
  errorMessage,
  pageImageUrl,
} from './message-reference-and-annotation-api.service';
import { ReferenceOverlayComponent } from './reference-overlay.component';

/**
 * View Reference: right-hand panel showing the referenced page with the
 * author's marks overlaid. Edit/delete controls only when can_edit is true.
 */
@Component({
  selector: 'app-reference-viewer',
  standalone: true,
  imports: [RouterLink, ReferenceOverlayComponent],
  template: `
    <aside class="ref-panel" data-testid="reference-panel" aria-labelledby="ref-heading">
      <header class="ref-head">
        <h2 id="ref-heading">Reference</h2>
        @if (ref(); as r) { <span class="muted" data-testid="reference-page-number">Page {{ r.page_number }}</span> }
        <a [routerLink]="['/projects', projectId()]" data-testid="reference-close" aria-label="Close reference">Close</a>
      </header>

      @if (loading()) { <p class="muted">Loading reference…</p> }
      @if (error(); as e) { <div class="error" role="alert" data-testid="reference-error">{{ e }}</div> }

      @if (ref(); as r) {
        @if (r.can_edit) {
          <div class="ref-actions">
            <button type="button" data-testid="reference-edit" (click)="edit()">Edit</button>
            <button type="button" data-testid="reference-delete" (click)="remove()" [disabled]="busy()">Delete</button>
          </div>
        }
        @if (r.file_available) {
          <div class="ref-page">
            <img data-testid="reference-page" [src]="pageUrl(r)" [alt]="'Referenced page ' + r.page_number" />
            <app-reference-overlay [annotations]="r.annotations" />
          </div>
        } @else {
          <p class="muted" data-testid="reference-unavailable">This file is no longer available</p>
        }
      }
    </aside>
  `,
  styles: [`
    :host { display: block; }
    .ref-panel { position: fixed; top: 0; right: 0; bottom: 0; width: min(640px, 100%); overflow: auto;
      padding: 1rem; background: var(--surface, white); border-left: 1px solid var(--border, #ddd); z-index: 20; }
    .ref-head { display: flex; align-items: center; gap: 0.75rem; }
    .ref-head a { margin-left: auto; }
    .ref-actions { display: flex; gap: 0.5rem; margin: 0.5rem 0; }
    .ref-page { position: relative; min-height: 200px; }
    .ref-page img { display: block; width: 100%; min-height: 200px; }
  `],
})
export class ReferenceViewerComponent {
  private api = inject(MessageReferenceApiService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  readonly projectId = signal('');
  readonly referenceId = signal('');
  readonly ref = signal<ReferenceView | null>(null);
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed(inject(DestroyRef))).subscribe((p) => {
      this.projectId.set(p.get('id') ?? '');
      this.referenceId.set(p.get('referenceId') ?? '');
      void this.load();
    });
  }

  pageUrl(r: ReferenceView): string {
    return pageImageUrl(r.file_version_id, r.page_number);
  }

  async load(): Promise<void> {
    const id = this.referenceId();
    if (!id) return;
    this.loading.set(true);
    this.error.set(null);
    try {
      this.ref.set(await this.api.get(id));
    } catch (err) {
      this.ref.set(null);
      this.error.set(errorMessage(err, 'Could not load the reference'));
    } finally {
      this.loading.set(false);
    }
  }

  edit(): void {
    const r = this.ref();
    if (!r?.can_edit) return;
    void this.router.navigate(['/projects', this.projectId(), 'references', 'new'], {
      queryParams: { referenceId: r.id, messageId: r.message_id },
    });
  }

  async remove(): Promise<void> {
    const r = this.ref();
    if (!r?.can_edit) return;
    this.busy.set(true);
    try {
      await this.api.remove(r.id);
      void this.router.navigate(['/projects', this.projectId()]);
    } catch (err) {
      this.error.set(errorMessage(err, 'Could not delete the reference'));
    } finally {
      this.busy.set(false);
    }
  }
}
