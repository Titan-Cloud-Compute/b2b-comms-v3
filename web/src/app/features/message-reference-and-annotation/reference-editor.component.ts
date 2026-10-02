import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  Drawing,
  MessageReferenceApiService,
  PickerFile,
  Point,
  TextBox,
  UNSUPPORTED_FILE_MESSAGE,
  errorMessage,
  isReferenceable,
  pageImageUrl,
} from './message-reference-and-annotation-api.service';

type Tool = 'text' | 'draw';

/**
 * Reference editor: pick a PDF/image from the project files, go to a page,
 * add text boxes and freehand drawings, then save (create, or update when
 * opened with ?referenceId= by the author).
 */
@Component({
  selector: 'app-reference-editor',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <div class="ref-editor" data-testid="reference-editor">
      <header class="ref-head">
        <h1>{{ referenceId() ? 'Edit reference' : 'New reference' }}</h1>
        <a [routerLink]="['/projects', projectId()]">Cancel</a>
      </header>

      @if (!referenceId()) {
        <section aria-labelledby="ref-files-heading">
          <h2 id="ref-files-heading">Choose a file</h2>
          <p class="muted" data-testid="file-picker-rule">{{ rule }}</p>
          <ul class="ref-files" role="listbox" aria-labelledby="ref-files-heading" data-testid="file-picker">
            @for (f of files(); track f.id) {
              <li role="option" data-testid="file-option" tabindex="0"
                [attr.aria-disabled]="supported(f) ? 'false' : 'true'"
                [attr.aria-selected]="selected()?.id === f.id"
                [class.disabled]="!supported(f)" [class.active]="selected()?.id === f.id"
                (click)="pick(f)" (keydown.enter)="pick(f)">
                {{ f.name }}
              </li>
            } @empty {
              @if (!loadingFiles()) { <li class="muted">No files in this project yet</li> }
            }
          </ul>
        </section>
      }

      <div class="ref-toolbar">
        <button type="button" data-testid="page-prev" (click)="goPage(page() - 1)" [disabled]="page() <= 1">Previous page</button>
        <label>Page
          <input type="number" min="1" data-testid="page-number" [ngModel]="page()" (ngModelChange)="goPage($event)" />
        </label>
        <button type="button" data-testid="page-next" (click)="goPage(page() + 1)" [disabled]="isImage()">Next page</button>
        <button type="button" data-testid="tool-text" [attr.aria-pressed]="tool() === 'text'" (click)="tool.set('text')">Text box</button>
        <button type="button" data-testid="tool-draw" [attr.aria-pressed]="tool() === 'draw'" (click)="tool.set('draw')">Draw</button>
        <button type="button" data-testid="tool-undo" (click)="undo()" [disabled]="isEmpty()">Undo</button>
      </div>

      <div class="ref-page">
        @if (versionId(); as v) {
          <img data-testid="editor-page" [src]="pageUrl(v)" [alt]="'Page ' + page()" />
        } @else {
          <div class="ref-blank muted">Select a file to annotate</div>
        }
        <svg data-testid="draw-surface" class="ref-surface" viewBox="0 0 1 1" preserveAspectRatio="none"
          [class.text-mode]="tool() === 'text'"
          (pointerdown)="down($event)" (pointermove)="move($event)" (pointerup)="up()" (pointerleave)="up()">
          @for (d of drawings(); track $index) {
            <polyline data-testid="editor-drawing" fill="none" vector-effect="non-scaling-stroke" stroke-linecap="round"
              stroke-linejoin="round" [attr.points]="points(d.points)" [attr.stroke]="d.color" [attr.stroke-width]="d.width" />
          }
          @if (stroke().length > 1) {
            <polyline fill="none" vector-effect="non-scaling-stroke" [attr.points]="points(stroke())" [attr.stroke]="color" stroke-width="3" />
          }
        </svg>
        <div class="ref-texts">
          @for (t of textBoxes(); track $index; let i = $index) {
            <input class="ref-text" data-testid="editor-textbox" [style.left.%]="t.x * 100" [style.top.%]="t.y * 100"
              placeholder="Type a note" [ngModel]="t.text" (ngModelChange)="setText(i, $event)" [attr.aria-label]="'Text box ' + (i + 1)" />
          }
        </div>
      </div>

      @if (error(); as e) { <div class="error" role="alert" data-testid="reference-editor-error">{{ e }}</div> }
      <button type="button" data-testid="reference-save" (click)="save()" [disabled]="busy()">Save reference</button>
    </div>
  `,
  styles: [`
    .ref-head, .ref-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; margin-bottom: 0.75rem; }
    .ref-head a { margin-left: auto; }
    .ref-files { list-style: none; padding: 0; display: flex; flex-wrap: wrap; gap: 0.5rem; }
    .ref-files li { padding: 0.25rem 0.5rem; border: 1px solid var(--border, #ccc); cursor: pointer; }
    .ref-files li.active { outline: 2px solid currentColor; }
    .ref-files li.disabled { opacity: 0.5; cursor: not-allowed; }
    .ref-page { position: relative; min-height: 400px; border: 1px solid var(--border, #ccc); margin-bottom: 0.75rem; }
    .ref-page img { display: block; width: 100%; }
    .ref-blank { padding: 2rem; text-align: center; }
    .ref-surface { position: absolute; inset: 0; width: 100%; height: 100%; touch-action: none; cursor: crosshair; }
    .ref-surface.text-mode { cursor: text; }
    .ref-texts { position: absolute; inset: 0; pointer-events: none; }
    .ref-text { position: absolute; pointer-events: auto; max-width: 50%; }
  `],
})
export class ReferenceEditorComponent {
  private api = inject(MessageReferenceApiService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  readonly rule = UNSUPPORTED_FILE_MESSAGE;
  readonly color = '#d33';

  readonly projectId = signal('');
  readonly messageId = signal('');
  readonly referenceId = signal('');
  readonly files = signal<PickerFile[]>([]);
  readonly selected = signal<PickerFile | null>(null);
  readonly versionId = signal<string | null>(null);
  readonly mime = signal<string | null>(null);
  readonly page = signal(1);
  readonly tool = signal<Tool>('draw');
  readonly textBoxes = signal<TextBox[]>([]);
  readonly drawings = signal<Drawing[]>([]);
  readonly stroke = signal<Point[]>([]);
  readonly loadingFiles = signal(false);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  readonly isImage = computed(() => String(this.mime() ?? '').toLowerCase().startsWith('image/'));
  readonly isEmpty = computed(() => this.textBoxes().length === 0 && this.drawings().length === 0);

  private drawing = false;

  constructor() {
    const destroyRef = inject(DestroyRef);
    this.route.paramMap.pipe(takeUntilDestroyed(destroyRef)).subscribe((p) => this.projectId.set(p.get('id') ?? ''));
    this.route.queryParamMap.pipe(takeUntilDestroyed(destroyRef)).subscribe((q) => {
      this.messageId.set(q.get('messageId') ?? '');
      this.referenceId.set(q.get('referenceId') ?? '');
      void (this.referenceId() ? this.loadReference() : this.loadFiles());
    });
  }

  supported(f: PickerFile): boolean {
    return isReferenceable(f.mime_type);
  }

  pageUrl(versionId: string): string {
    return pageImageUrl(versionId, this.page());
  }

  points(ps: Point[]): string {
    return ps.map((p) => `${p.x},${p.y}`).join(' ');
  }

  private async loadFiles(): Promise<void> {
    this.loadingFiles.set(true);
    try {
      this.files.set(await this.api.listFiles(this.projectId()));
    } catch (err) {
      this.error.set(errorMessage(err, 'Could not load project files'));
    } finally {
      this.loadingFiles.set(false);
    }
  }

  private async loadReference(): Promise<void> {
    try {
      const r = await this.api.get(this.referenceId());
      if (!r.can_edit) {
        void this.router.navigate(['/projects', this.projectId(), 'references', r.id]);
        return;
      }
      this.messageId.set(r.message_id);
      this.versionId.set(r.file_version_id);
      this.mime.set(r.mime_type ?? null);
      this.page.set(r.page_number);
      this.textBoxes.set(r.annotations.text_boxes.map((t) => ({ ...t })));
      this.drawings.set(r.annotations.drawings.map((d) => ({ ...d, points: [...d.points] })));
    } catch (err) {
      this.error.set(errorMessage(err, 'Could not load the reference'));
    }
  }

  async pick(f: PickerFile): Promise<void> {
    if (!this.supported(f)) {
      this.error.set(UNSUPPORTED_FILE_MESSAGE);
      return;
    }
    this.error.set(null);
    this.selected.set(f);
    this.mime.set(f.mime_type);
    this.page.set(1);
    try {
      this.versionId.set(await this.api.currentVersionId(f));
    } catch (err) {
      this.error.set(errorMessage(err, 'Could not load the file'));
    }
  }

  goPage(n: unknown): void {
    const v = Math.floor(Number(n));
    if (!Number.isFinite(v) || v < 1) return;
    this.page.set(this.isImage() ? 1 : v);
  }

  private pointOf(ev: PointerEvent): Point {
    const rect = (ev.currentTarget as Element).getBoundingClientRect();
    const clamp = (n: number) => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));
    const r = (n: number) => Math.round(n * 10000) / 10000;
    return { x: r(clamp((ev.clientX - rect.left) / (rect.width || 1))), y: r(clamp((ev.clientY - rect.top) / (rect.height || 1))) };
  }

  down(ev: PointerEvent): void {
    const p = this.pointOf(ev);
    if (this.tool() === 'text') {
      this.textBoxes.update((list) => [...list, { x: p.x, y: p.y, text: '' }]);
      return;
    }
    this.drawing = true;
    (ev.currentTarget as Element).setPointerCapture?.(ev.pointerId);
    this.stroke.set([p]);
  }

  move(ev: PointerEvent): void {
    if (!this.drawing) return;
    const p = this.pointOf(ev);
    this.stroke.update((s) => [...s, p]);
  }

  up(): void {
    if (!this.drawing) return;
    this.drawing = false;
    const s = this.stroke();
    if (s.length > 1) this.drawings.update((list) => [...list, { points: s, color: this.color, width: 3 }]);
    this.stroke.set([]);
  }

  setText(i: number, text: string): void {
    this.textBoxes.update((list) => list.map((t, j) => (j === i ? { ...t, text } : t)));
  }

  undo(): void {
    if (this.drawings().length) this.drawings.update((l) => l.slice(0, -1));
    else this.textBoxes.update((l) => l.slice(0, -1));
  }

  async save(): Promise<void> {
    const annotations = { text_boxes: this.textBoxes().filter((t) => t.text.trim()), drawings: this.drawings() };
    if (!annotations.text_boxes.length && !annotations.drawings.length) {
      this.error.set('Add at least one text box or drawing before saving');
      return;
    }
    const versionId = this.versionId();
    if (!versionId) {
      this.error.set('Choose a PDF or image file first');
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      let id = this.referenceId();
      if (id) {
        await this.api.update(id, { page_number: this.page(), annotations });
      } else {
        if (!this.messageId()) throw new Error('No message to attach the reference to');
        id = (await this.api.create(this.messageId(), { file_version_id: versionId, page_number: this.page(), annotations })).id;
      }
      void this.router.navigate(['/projects', this.projectId(), 'references', id]);
    } catch (err) {
      this.error.set(errorMessage(err, 'Could not save the reference'));
    } finally {
      this.busy.set(false);
    }
  }
}
