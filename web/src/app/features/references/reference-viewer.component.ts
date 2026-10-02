import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  ReferenceView,
  ReferencesApi,
  StrokeAnnotation,
  TextBoxAnnotation,
  strokePoints,
} from './references.api';

/** Right-side panel showing a referenced page with the author's markings overlaid. */
@Component({
  selector: 'app-reference-viewer',
  standalone: true,
  imports: [RouterLink],
  template: `
    <aside class="ref-panel" data-testid="reference-viewer" aria-label="Reference viewer">
      <header class="ref-head">
        <h2>Reference</h2>
        <a class="ref-close" [routerLink]="['/projects', projectId]" aria-label="Close reference">Close</a>
      </header>

      @if (loading()) {
        <p data-testid="reference-loading">Loading reference…</p>
      } @else if (error()) {
        <p class="ref-error" role="alert" data-testid="reference-error">{{ error() }}</p>
      } @else if (ref(); as r) {
        <p class="ref-meta">
          @if (r.file_available) {
            <span data-testid="reference-file-name">{{ r.file_name }}</span> · Page {{ r.page_number }}
          }
        </p>

        @if (!r.file_available) {
          <p class="ref-error" data-testid="reference-file-unavailable">This file is no longer available</p>
        } @else {
          <div class="ref-stage">
            <img
              data-testid="reference-page-image"
              [attr.src]="imageUrl()"
              [alt]="'Page ' + r.page_number + ' of ' + r.file_name"
            />
            <div class="ref-overlay" data-testid="reference-overlay">
              <svg viewBox="0 0 1 1" preserveAspectRatio="none" class="ref-svg">
                @for (s of strokes(); track $index) {
                  <polyline
                    data-annotation="stroke"
                    [attr.points]="points(s)"
                    fill="none"
                    [attr.stroke]="s.color || '#e11d48'"
                    [attr.stroke-width]="s.width || 3"
                    vector-effect="non-scaling-stroke"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                }
              </svg>
              @for (t of textBoxes(); track $index) {
                <div
                  class="ref-text"
                  data-annotation="text"
                  [style.left.%]="t.x * 100"
                  [style.top.%]="t.y * 100"
                >{{ t.text }}</div>
              }
            </div>
          </div>
        }

        @if (r.can_edit) {
          <div class="ref-actions">
            <a
              data-testid="reference-edit"
              [routerLink]="['/projects', projectId, 'references', 'new']"
              [queryParams]="{ referenceId: r.id, messageId: r.message_id }"
            >Edit</a>
            <button type="button" data-testid="reference-delete" (click)="remove()" [disabled]="busy()">Delete</button>
          </div>
        }
      }
    </aside>
  `,
  styles: [
    `
      :host { display: block; }
      .ref-panel {
        position: fixed; top: 0; right: 0; bottom: 0; z-index: 50;
        width: min(560px, 100vw); overflow-y: auto; padding: 16px;
        background: #fff; box-shadow: -4px 0 16px rgba(0, 0, 0, 0.15);
      }
      .ref-head { display: flex; justify-content: space-between; align-items: center; }
      .ref-head h2 { margin: 0; font-size: 1.1rem; }
      .ref-stage { position: relative; margin-top: 8px; min-height: 200px; }
      .ref-stage img { display: block; width: 100%; height: auto; min-height: 200px; }
      .ref-overlay { position: absolute; inset: 0; pointer-events: none; }
      .ref-svg { position: absolute; inset: 0; width: 100%; height: 100%; }
      .ref-text {
        position: absolute; max-width: 60%; padding: 2px 6px; font-size: 0.85rem;
        background: rgba(255, 247, 200, 0.92); border: 1px solid #e11d48; border-radius: 4px; white-space: pre-wrap;
      }
      .ref-actions { display: flex; gap: 12px; margin-top: 12px; align-items: center; }
      .ref-error { color: #b91c1c; }
    `,
  ],
})
export class ReferenceViewerComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private api = inject(ReferencesApi);

  projectId = '';
  readonly ref = signal<ReferenceView | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly busy = signal(false);
  readonly imageUrl = signal<string | null>(null);

  readonly strokes = computed(() =>
    (this.ref()?.annotations ?? []).filter((a): a is StrokeAnnotation => a?.type === 'stroke' && Array.isArray(a.points)),
  );
  readonly textBoxes = computed(() =>
    (this.ref()?.annotations ?? []).filter((a): a is TextBoxAnnotation => a?.type === 'text'),
  );

  private objectUrl: string | null = null;

  ngOnInit(): void {
    this.route.paramMap.subscribe((pm) => {
      this.projectId = pm.get('id') ?? '';
      const referenceId = pm.get('referenceId') ?? '';
      void this.load(referenceId);
    });
  }

  ngOnDestroy(): void {
    this.revoke();
  }

  points(s: StrokeAnnotation): string {
    return strokePoints(s);
  }

  async load(referenceId: string): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    this.revoke();
    try {
      const r = await this.api.get(referenceId);
      this.ref.set(r);
      if (r.file_available) void this.loadImage(r);
    } catch (e: unknown) {
      const status = (e as { status?: number })?.status;
      this.error.set(
        status === 403 ? 'You do not have access to this reference.' :
        status === 404 ? 'Reference not found.' : 'Could not load the reference.',
      );
    } finally {
      this.loading.set(false);
    }
  }

  private async loadImage(r: ReferenceView): Promise<void> {
    try {
      this.objectUrl = await this.api.pageImageUrl(r.file_version_id, r.page_number || 1);
      this.imageUrl.set(this.objectUrl);
    } catch {
      this.imageUrl.set(null);
    }
  }

  async remove(): Promise<void> {
    const r = this.ref();
    if (!r || !r.can_edit) return;
    this.busy.set(true);
    try {
      await this.api.remove(r.id);
      await this.router.navigate(['/projects', this.projectId]);
    } catch {
      this.error.set('Could not delete the reference.');
    } finally {
      this.busy.set(false);
    }
  }

  private revoke(): void {
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
    this.imageUrl.set(null);
  }
}
