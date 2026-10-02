import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  Annotation,
  ReferenceableFile,
  ReferencesApi,
  StrokeAnnotation,
  TextBoxAnnotation,
  UNSUPPORTED_FILE_MESSAGE,
  clamp01,
  isReferenceableMime,
  strokePoints,
} from './references.api';

type Tool = 'text' | 'draw';

/** Reference editor: pick a PDF/image, choose a page, add text boxes and freehand strokes, save. */
@Component({
  selector: 'app-reference-editor',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <section class="ref-editor" data-testid="reference-editor">
      <header class="ref-head">
        <h1>{{ referenceId ? 'Edit reference' : 'New reference' }}</h1>
        <a [routerLink]="['/projects', projectId]">Cancel</a>
      </header>

      @if (error()) {
        <p class="ref-error" role="alert" data-testid="reference-error">{{ error() }}</p>
      }

      @if (!referenceId) {
        <div class="ref-picker" data-testid="reference-file-picker">
          <p class="ref-hint">{{ unsupportedMessage }}</p>
          @if (filesLoading()) {
            <p>Loading files…</p>
          } @else if (files().length === 0) {
            <p>No files in this project yet.</p>
          }
          <ul>
            @for (f of files(); track f.id) {
              <li>
                <button
                  type="button"
                  data-testid="reference-file-option"
                  [attr.data-mime]="f.mimeType"
                  [disabled]="!isSupported(f)"
                  [class.selected]="selected()?.id === f.id"
                  [attr.aria-pressed]="selected()?.id === f.id"
                  [title]="isSupported(f) ? f.name : unsupportedMessage"
                  (click)="select(f)"
                >{{ f.name }}</button>
              </li>
            }
          </ul>
        </div>
      }

      @if (versionId()) {
        <div class="ref-toolbar">
          <div class="ref-pages">
            <button type="button" data-testid="reference-page-prev" (click)="goToPage(page() - 1)" [disabled]="page() <= 1 || !isPdf()">Prev</button>
            <span data-testid="reference-page-number">Page {{ page() }}</span>
            <button type="button" data-testid="reference-page-next" (click)="goToPage(page() + 1)" [disabled]="!isPdf() || !!referenceId">Next</button>
          </div>
          <div class="ref-tools" role="group" aria-label="Annotation tools">
            <button type="button" data-testid="reference-tool-text" [class.active]="tool() === 'text'" [attr.aria-pressed]="tool() === 'text'" (click)="tool.set('text')">Text box</button>
            <button type="button" data-testid="reference-tool-draw" [class.active]="tool() === 'draw'" [attr.aria-pressed]="tool() === 'draw'" (click)="tool.set('draw')">Draw</button>
            @if (tool() === 'text') {
              <input data-testid="reference-text-input" [(ngModel)]="newText" placeholder="Text for the box, then click the page" aria-label="Text box content" />
            }
            <button type="button" data-testid="reference-undo" (click)="undo()" [disabled]="annotations().length === 0">Undo</button>
          </div>
        </div>

        <div class="ref-stage" data-testid="reference-canvas"
             (pointerdown)="onPointerDown($event)" (pointermove)="onPointerMove($event)"
             (pointerup)="onPointerUp()" (pointerleave)="onPointerUp()">
          @if (pageError()) {
            <p class="ref-error">{{ pageError() }}</p>
          }
          <img data-testid="reference-page-image" [attr.src]="imageUrl()" alt="Referenced page" draggable="false" />
          <div class="ref-overlay" data-testid="reference-overlay">
            <svg viewBox="0 0 1 1" preserveAspectRatio="none" class="ref-svg">
              @for (s of strokes(); track $index) {
                <polyline data-annotation="stroke" [attr.points]="points(s)" fill="none"
                  [attr.stroke]="s.color || '#e11d48'" [attr.stroke-width]="s.width || 3"
                  vector-effect="non-scaling-stroke" stroke-linecap="round" stroke-linejoin="round" />
              }
            </svg>
            @for (t of textBoxes(); track $index) {
              <div class="ref-text" data-annotation="text" [style.left.%]="t.x * 100" [style.top.%]="t.y * 100">{{ t.text }}</div>
            }
          </div>
        </div>
      }

      <div class="ref-actions">
        <button type="button" data-testid="reference-save" (click)="save()" [disabled]="!canSave()">Save reference</button>
      </div>
    </section>
  `,
  styles: [
    `
      .ref-editor { max-width: 900px; margin: 0 auto; padding: 16px; }
      .ref-head { display: flex; justify-content: space-between; align-items: center; }
      .ref-picker ul { list-style: none; padding: 0; display: flex; flex-wrap: wrap; gap: 8px; }
      .ref-picker button.selected, .ref-tools button.active { outline: 2px solid #2563eb; }
      .ref-picker button:disabled { opacity: 0.5; cursor: not-allowed; }
      .ref-hint { font-size: 0.85rem; opacity: 0.8; }
      .ref-toolbar { display: flex; flex-wrap: wrap; gap: 16px; align-items: center; margin: 12px 0; }
      .ref-pages, .ref-tools { display: flex; gap: 8px; align-items: center; }
      .ref-stage { position: relative; min-height: 300px; border: 1px solid #ccc; touch-action: none; user-select: none; cursor: crosshair; }
      .ref-stage img { display: block; width: 100%; height: auto; min-height: 300px; pointer-events: none; }
      .ref-overlay { position: absolute; inset: 0; pointer-events: none; }
      .ref-svg { position: absolute; inset: 0; width: 100%; height: 100%; }
      .ref-text {
        position: absolute; max-width: 60%; padding: 2px 6px; font-size: 0.85rem;
        background: rgba(255, 247, 200, 0.92); border: 1px solid #e11d48; border-radius: 4px; white-space: pre-wrap;
      }
      .ref-actions { margin-top: 12px; }
      .ref-error { color: #b91c1c; }
    `,
  ],
})
export class ReferenceEditorComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private api = inject(ReferencesApi);

  readonly unsupportedMessage = UNSUPPORTED_FILE_MESSAGE;

  projectId = '';
  messageId = '';
  referenceId = '';
  newText = '';

  readonly files = signal<ReferenceableFile[]>([]);
  readonly filesLoading = signal(false);
  readonly selected = signal<ReferenceableFile | null>(null);
  readonly versionId = signal<string | null>(null);
  readonly mimeType = signal<string>('');
  readonly page = signal(1);
  readonly tool = signal<Tool>('draw');
  readonly annotations = signal<Annotation[]>([]);
  readonly imageUrl = signal<string | null>(null);
  readonly pageError = signal<string | null>(null);
  readonly error = signal<string | null>(null);
  readonly saving = signal(false);

  readonly isPdf = computed(() => this.mimeType().toLowerCase() === 'application/pdf');
  readonly strokes = computed(() =>
    this.annotations().filter((a): a is StrokeAnnotation => a.type === 'stroke'),
  );
  readonly textBoxes = computed(() =>
    this.annotations().filter((a): a is TextBoxAnnotation => a.type === 'text'),
  );
  readonly canSave = computed(
    () =>
      !this.saving() &&
      !!this.versionId() &&
      this.annotations().length > 0 &&
      (!!this.referenceId || (!!this.messageId && !!this.selected())),
  );

  private drawing: StrokeAnnotation | null = null;
  private objectUrl: string | null = null;

  ngOnInit(): void {
    const snap = this.route.snapshot;
    this.projectId = snap.paramMap.get('id') ?? '';
    this.messageId = snap.queryParamMap.get('messageId') ?? '';
    this.referenceId = snap.queryParamMap.get('referenceId') ?? '';
    if (this.referenceId) void this.loadExisting();
    else void this.loadFiles();
  }

  ngOnDestroy(): void {
    this.revoke();
  }

  isSupported(f: ReferenceableFile): boolean {
    return isReferenceableMime(f.mimeType) && !!f.currentVersionId;
  }

  points(s: StrokeAnnotation): string {
    return strokePoints(s);
  }

  private async loadFiles(): Promise<void> {
    this.filesLoading.set(true);
    try {
      this.files.set(await this.api.listFiles(this.projectId));
    } catch {
      this.error.set('Could not load project files.');
    } finally {
      this.filesLoading.set(false);
    }
  }

  private async loadExisting(): Promise<void> {
    try {
      const r = await this.api.get(this.referenceId);
      if (!r.can_edit) {
        await this.router.navigate(['/projects', this.projectId, 'references', r.id]);
        return;
      }
      if (!r.file_available) {
        this.error.set('This file is no longer available');
        return;
      }
      this.messageId = r.message_id;
      this.mimeType.set(r.mime_type ?? '');
      this.annotations.set(Array.isArray(r.annotations) ? r.annotations : []);
      this.versionId.set(r.file_version_id);
      this.page.set(r.page_number || 1);
      void this.loadPage();
    } catch {
      this.error.set('Could not load the reference.');
    }
  }

  select(f: ReferenceableFile): void {
    if (!this.isSupported(f)) {
      this.error.set(UNSUPPORTED_FILE_MESSAGE);
      return;
    }
    this.error.set(null);
    this.selected.set(f);
    this.mimeType.set(f.mimeType);
    this.versionId.set(f.currentVersionId);
    this.page.set(1);
    this.annotations.set([]);
    void this.loadPage();
  }

  goToPage(n: number): void {
    if (n < 1 || (!this.isPdf() && n !== 1)) return;
    const prev = this.page();
    this.page.set(n);
    void this.loadPage(prev);
  }

  private async loadPage(fallbackPage?: number): Promise<void> {
    const v = this.versionId();
    if (!v) return;
    this.pageError.set(null);
    try {
      const url = await this.api.pageImageUrl(v, this.page());
      this.revoke();
      this.objectUrl = url;
      this.imageUrl.set(url);
    } catch {
      this.pageError.set(`Page ${this.page()} could not be loaded.`);
      if (fallbackPage) this.page.set(fallbackPage);
    }
  }

  private relPoint(ev: PointerEvent): [number, number] | null {
    const el = ev.currentTarget as HTMLElement | null;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return [clamp01((ev.clientX - rect.left) / rect.width), clamp01((ev.clientY - rect.top) / rect.height)];
  }

  onPointerDown(ev: PointerEvent): void {
    const p = this.relPoint(ev);
    if (!p) return;
    if (this.tool() === 'text') {
      const text = this.newText.trim() || 'Note';
      this.annotations.update((list) => [...list, { type: 'text', x: p[0], y: p[1], text }]);
      this.newText = '';
      return;
    }
    (ev.currentTarget as HTMLElement).setPointerCapture?.(ev.pointerId);
    this.drawing = { type: 'stroke', points: [p], color: '#e11d48', width: 3 };
    this.annotations.update((list) => [...list, this.drawing as StrokeAnnotation]);
  }

  onPointerMove(ev: PointerEvent): void {
    if (!this.drawing) return;
    const p = this.relPoint(ev);
    if (!p) return;
    const current = this.drawing;
    const next: StrokeAnnotation = { ...current, points: [...current.points, p] };
    this.drawing = next;
    this.annotations.update((list) => list.map((a) => (a === current ? next : a)));
  }

  onPointerUp(): void {
    this.drawing = null;
  }

  undo(): void {
    this.annotations.update((list) => list.slice(0, -1));
  }

  async save(): Promise<void> {
    if (!this.canSave()) return;
    this.saving.set(true);
    this.error.set(null);
    try {
      const saved = this.referenceId
        ? await this.api.update(this.referenceId, this.annotations())
        : await this.api.create(this.messageId, {
            fileId: this.selected()!.id,
            pageNumber: this.page(),
            annotations: this.annotations(),
          });
      await this.router.navigate(['/projects', this.projectId, 'references', saved.id]);
    } catch (e: unknown) {
      const err = e as { error?: { message?: string | string[] }; message?: string };
      const msg = err?.error?.message;
      this.error.set((Array.isArray(msg) ? msg.join(', ') : msg) || 'Could not save the reference.');
    } finally {
      this.saving.set(false);
    }
  }

  private revoke(): void {
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
  }
}
