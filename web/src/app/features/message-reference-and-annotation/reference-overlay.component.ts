import { Component, input } from '@angular/core';
import type { Annotations, Point } from './message-reference-and-annotation-api.service';

/** Read-only overlay: the author's text boxes and freehand drawings in page-relative (0..1) coordinates. */
@Component({
  selector: 'app-reference-overlay',
  standalone: true,
  template: `
    <div class="ref-overlay" data-testid="reference-overlay">
      <svg class="ref-ink" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
        @for (d of annotations().drawings; track $index) {
          <polyline data-testid="overlay-drawing" fill="none" vector-effect="non-scaling-stroke"
            stroke-linecap="round" stroke-linejoin="round"
            [attr.points]="points(d.points)" [attr.stroke]="d.color || 'currentColor'" [attr.stroke-width]="d.width || 3" />
        }
      </svg>
      @for (t of annotations().text_boxes; track $index) {
        <div class="ref-text" data-testid="overlay-textbox" [style.left.%]="t.x * 100" [style.top.%]="t.y * 100">{{ t.text }}</div>
      }
    </div>
  `,
  styles: [`
    .ref-overlay { position: absolute; inset: 0; pointer-events: none; }
    .ref-ink { position: absolute; inset: 0; width: 100%; height: 100%; color: var(--danger, crimson); }
    .ref-text { position: absolute; max-width: 60%; padding: 2px 6px; border: 1px solid currentColor;
      background: var(--surface, white); color: var(--danger, crimson); white-space: pre-wrap; font-size: 0.85rem; }
  `],
})
export class ReferenceOverlayComponent {
  readonly annotations = input.required<Annotations>();

  points(ps: Point[]): string {
    return ps.map((p) => `${p.x},${p.y}`).join(' ');
  }
}
