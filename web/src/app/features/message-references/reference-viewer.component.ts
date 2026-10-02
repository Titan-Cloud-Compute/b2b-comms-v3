import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { ReferencesApiService } from './references-api.service';
import { Reference } from './reference.types';
import { AnnotationOverlayComponent } from './annotation-overlay.component';

@Component({
  selector: 'app-reference-viewer',
  standalone: true,
  imports: [AnnotationOverlayComponent],
  template: `
    <div class="viewer-panel" data-testid="reference-viewer">
      <div class="viewer-header">
        <span class="viewer-title" data-testid="reference-file-name">{{ reference()?.fileName ?? '' }}</span>
        <button type="button" class="close-btn" data-testid="reference-close" (click)="close()">✕</button>
      </div>

      @if (error()) {
        <p role="alert" class="viewer-error" data-testid="reference-error">{{ error() }}</p>
      }

      @if (!error() && reference()) {
        @if (reference()!.fileAvailable) {
          <div class="image-wrapper">
            <img
              data-testid="reference-page-image"
              [src]="reference()!.pageUrl"
              [alt]="'Page ' + reference()!.pageNumber + ' of ' + reference()!.fileName" />
            <app-annotation-overlay [annotations]="reference()!.annotations" />
          </div>
        } @else {
          <p class="viewer-unavailable" data-testid="reference-unavailable">This file is no longer available.</p>
        }

        @if (reference()!.canEdit) {
          <div class="viewer-actions">
            <button type="button" class="btn-secondary" data-testid="reference-edit" (click)="edit()">Edit</button>
            <button type="button" class="btn-danger" data-testid="reference-delete" (click)="remove()">Delete</button>
          </div>
        }
      }
    </div>
  `,
  styles: [`
    .viewer-panel {
      position: fixed;
      top: 0;
      right: 0;
      width: 420px;
      max-width: 100vw;
      height: 100vh;
      background: var(--color-surface);
      border-left: 1px solid var(--color-border);
      box-shadow: var(--shadow-lg);
      display: flex;
      flex-direction: column;
      z-index: 200;
      overflow: hidden;
    }
    .viewer-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 1rem;
      border-bottom: 1px solid var(--color-border);
      flex-shrink: 0;
    }
    .viewer-title {
      font-weight: 600;
      font-family: var(--font-body);
      color: var(--color-text-primary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .close-btn {
      background: none;
      border: none;
      cursor: pointer;
      font-size: 1.2rem;
      color: var(--color-text-secondary);
      padding: 0.25rem 0.5rem;
      border-radius: var(--radius-sm);
    }
    .close-btn:hover { background: var(--color-surface-hover); }
    .image-wrapper {
      position: relative;
      flex: 1;
      overflow: auto;
      background: var(--color-bg-secondary);
    }
    .image-wrapper img {
      display: block;
      width: 100%;
      height: auto;
    }
    .viewer-error, .viewer-unavailable {
      padding: 1.5rem;
      color: var(--color-text-secondary);
      font-family: var(--font-body);
    }
    .viewer-actions {
      display: flex;
      gap: 0.5rem;
      padding: 1rem;
      border-top: 1px solid var(--color-border);
      flex-shrink: 0;
    }
    .btn-secondary {
      padding: 0.5rem 1rem;
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm);
      background: var(--color-surface);
      color: var(--color-text-primary);
      cursor: pointer;
      font-family: var(--font-body);
    }
    .btn-secondary:hover { background: var(--color-surface-hover); }
    .btn-danger {
      padding: 0.5rem 1rem;
      border: 1px solid var(--color-error);
      border-radius: var(--radius-sm);
      background: var(--color-error-bg);
      color: var(--color-error);
      cursor: pointer;
      font-family: var(--font-body);
    }
    .btn-danger:hover { background: var(--color-error-100, var(--color-error-bg)); }
  `],
})
export class ReferenceViewerComponent implements OnInit, OnDestroy {
  private api = inject(ReferencesApiService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  reference = signal<Reference | null>(null);
  error = signal<string | null>(null);

  private sub?: Subscription;

  ngOnInit(): void {
    this.sub = this.route.paramMap.subscribe((params) => {
      const referenceId = params.get('referenceId') ?? '';
      if (referenceId) void this.load(referenceId);
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  async load(id: string): Promise<void> {
    this.error.set(null);
    this.reference.set(null);
    try {
      const ref = await this.api.getReference(id);
      this.reference.set(ref);
    } catch (e) {
      const status = (e as { status?: number } | null)?.status;
      if (status === 403) {
        this.error.set('You do not have access to this reference.');
      } else {
        this.error.set('Reference could not be loaded.');
      }
    }
  }

  close(): void {
    const projectId = this.route.snapshot.paramMap.get('id');
    if (projectId) {
      void this.router.navigate(['/projects', projectId]);
    } else {
      void this.router.navigate(['/projects']);
    }
  }

  edit(): void {
    const ref = this.reference();
    if (!ref) return;
    const projectId = this.route.snapshot.paramMap.get('id');
    void this.router.navigate(
      ['/projects', projectId, 'references', 'new'],
      { queryParams: { referenceId: ref.id } },
    );
  }

  async remove(): Promise<void> {
    if (!confirm('Delete this reference?')) return;
    const ref = this.reference();
    if (!ref) return;
    try {
      await this.api.deleteReference(ref.id);
      this.close();
    } catch {
      this.error.set('Reference could not be deleted.');
    }
  }
}
