import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ReferencesApiService } from './references-api.service';
import { AnnotationOverlayComponent } from './annotation-overlay.component';
import { Reference } from './reference.types';
import { ForbiddenError } from '../../shared/api/api-errors';

@Component({
  selector: 'app-reference-viewer',
  standalone: true,
  imports: [AnnotationOverlayComponent],
  template: `
    <div
      data-testid="reference-viewer"
      style="
        position: fixed;
        top: 0;
        right: 0;
        width: 480px;
        max-width: 100vw;
        height: 100vh;
        background: var(--color-bg-primary);
        box-shadow: var(--shadow-lg);
        display: flex;
        flex-direction: column;
        z-index: 200;
        overflow-y: auto;
      "
    >
      <!-- Header bar -->
      <div style="
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 16px;
        border-bottom: 1px solid var(--color-border);
        flex-shrink: 0;
      ">
        <span style="font-weight: 600; color: var(--color-text-primary); font-size: 0.95rem;">
          {{ reference()?.file_name ?? 'Reference' }}
        </span>
        <button
          type="button"
          data-testid="reference-close"
          (click)="close()"
          style="
            background: none;
            border: none;
            cursor: pointer;
            padding: 4px 8px;
            color: var(--color-text-secondary);
            font-size: 1.2rem;
            line-height: 1;
          "
          aria-label="Close"
        >×</button>
      </div>

      <!-- Body -->
      <div style="flex: 1; padding: 16px; display: flex; flex-direction: column; gap: 12px;">

        @if (loading()) {
          <p style="color: var(--color-text-secondary);">Loading…</p>
        }

        @if (forbidden()) {
          <p role="alert" data-testid="reference-forbidden" style="color: var(--color-error);">
            You do not have access to this reference
          </p>
        }

        @if (reference(); as ref) {
          @if (!ref.file_available) {
            <p data-testid="reference-unavailable" style="color: var(--color-text-secondary);">
              This file is no longer available
            </p>
          } @else {
            <!-- Page image + annotation overlay -->
            <div style="position: relative; width: 100%; line-height: 0;">
              <img
                data-testid="reference-page-image"
                [src]="ref.page_url"
                [alt]="'Page ' + ref.page_number + ' of ' + ref.file_name"
                style="width: 100%; display: block; border-radius: var(--radius-sm); border: 1px solid var(--color-border);"
              />
              <app-annotation-overlay
                [annotations]="ref.annotations"
                [editable]="ref.can_edit"
              />
            </div>
          }

          <!-- Author controls -->
          @if (ref.can_edit) {
            <div style="display: flex; gap: 8px; margin-top: 4px;">
              <button
                type="button"
                data-testid="reference-edit"
                (click)="editReference(ref)"
                style="
                  padding: 6px 14px;
                  background: var(--color-primary);
                  color: var(--color-on-primary);
                  border: none;
                  border-radius: var(--radius-sm);
                  cursor: pointer;
                  font-size: 0.875rem;
                "
              >Edit</button>
              <button
                type="button"
                data-testid="reference-delete"
                (click)="deleteReference(ref)"
                style="
                  padding: 6px 14px;
                  background: var(--color-accent);
                  color: var(--color-on-primary);
                  border: none;
                  border-radius: var(--radius-sm);
                  cursor: pointer;
                  font-size: 0.875rem;
                "
              >Delete</button>
            </div>
          }
        }

        @if (deleteError()) {
          <p role="alert" data-testid="reference-delete-error" style="color: var(--color-error);">
            {{ deleteError() }}
          </p>
        }

      </div>
    </div>
  `,
})
export class ReferenceViewerComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private api = inject(ReferencesApiService);

  readonly loading = signal(true);
  readonly forbidden = signal(false);
  readonly reference = signal<Reference | null>(null);
  readonly deleteError = signal<string | null>(null);

  ngOnInit(): void {
    const referenceId = this.route.snapshot.paramMap.get('referenceId') ?? '';
    this.loadReference(referenceId);
  }

  private async loadReference(referenceId: string): Promise<void> {
    this.loading.set(true);
    this.forbidden.set(false);
    try {
      const ref = await this.api.getReference(referenceId);
      this.reference.set(ref);
    } catch (err) {
      if (err instanceof ForbiddenError) {
        this.forbidden.set(true);
      }
      // Other errors (network, 404) leave the panel mostly empty — loading hides.
    } finally {
      this.loading.set(false);
    }
  }

  close(): void {
    const projectId = this.route.snapshot.paramMap.get('id');
    void this.router.navigate(['/projects', projectId]);
  }

  editReference(ref: Reference): void {
    const projectId = this.route.snapshot.paramMap.get('id');
    void this.router.navigate(
      ['/projects', projectId, 'references', 'new'],
      { queryParams: { referenceId: ref.id } },
    );
  }

  async deleteReference(ref: Reference): Promise<void> {
    if (!confirm('Delete this reference? This cannot be undone.')) return;
    this.deleteError.set(null);
    try {
      await this.api.deleteReference(ref.id);
      this.close();
    } catch {
      this.deleteError.set('Failed to delete the reference. Please try again.');
    }
  }
}
