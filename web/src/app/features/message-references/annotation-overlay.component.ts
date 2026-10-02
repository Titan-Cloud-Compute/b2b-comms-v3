import { Component, Input } from '@angular/core';
import { Annotation, TextAnnotation, PathAnnotation } from './reference.types';

/**
 * Renders the annotation layer as an absolutely-positioned SVG over the page image.
 *
 * Uses viewBox="0 0 1 1" + preserveAspectRatio="none" so that normalised
 * annotation coordinates (0..1) scale with the image at any panel width —
 * the same technique used by PDF.js annotation layers and Hypothesis.
 */
@Component({
  selector: 'app-annotation-overlay',
  standalone: true,
  template: `
    <svg data-testid="reference-overlay"
         viewBox="0 0 1 1"
         preserveAspectRatio="none"
         xmlns="http://www.w3.org/2000/svg"
         aria-hidden="true">
      @for (ann of annotations; track $index) {
        @if (ann.type === 'text') {
          <foreignObject
            data-annotation
            [attr.x]="asText(ann).x"
            [attr.y]="asText(ann).y"
            [attr.width]="asText(ann).width"
            [attr.height]="asText(ann).height">
            <div xmlns="http://www.w3.org/1999/xhtml" class="ann-text">{{ asText(ann).text }}</div>
          </foreignObject>
        }
        @if (ann.type === 'path') {
          <polyline
            data-annotation
            [attr.points]="pointsStr(asPath(ann).points)"
            fill="none"
            stroke="var(--color-primary)"
            stroke-width="0.005"
            stroke-linecap="round"
            stroke-linejoin="round" />
        }
      }
    </svg>
  `,
  styles: [`
    :host {
      position: absolute;
      inset: 0;
      pointer-events: none;
    }
    svg {
      width: 100%;
      height: 100%;
    }
    .ann-text {
      font-size: 0.04px;
      color: var(--color-text-primary);
      overflow: hidden;
      white-space: pre-wrap;
    }
  `],
})
export class AnnotationOverlayComponent {
  @Input() annotations: Annotation[] = [];
  /** Reserved for the editor unit — no edit controls are rendered here. */
  @Input() editable = false;

  asText(ann: Annotation): TextAnnotation { return ann as TextAnnotation; }
  asPath(ann: Annotation): PathAnnotation { return ann as PathAnnotation; }

  pointsStr(points: Array<[number, number]>): string {
    return points.map(([x, y]) => `${x},${y}`).join(' ');
  }
}
