import { Component, Input } from '@angular/core';
import { Annotation, TextAnnotation, PathAnnotation } from './reference.types';

/**
 * Renders a transparent SVG overlay with a viewBox of "0 0 1 1" and
 * preserveAspectRatio="none" positioned absolutely over a page image.
 * Normalised annotation coordinates (0–1) therefore map directly to the
 * percentage layout of the image at any panel width.
 *
 * Each annotation carries a `data-annotation` attribute so tests and
 * accessibility tools can address individual items.
 */
@Component({
  selector: 'app-annotation-overlay',
  standalone: true,
  template: `
    <svg
      data-testid="reference-overlay"
      viewBox="0 0 1 1"
      preserveAspectRatio="none"
      xmlns="http://www.w3.org/2000/svg"
      style="position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none;"
    >
      @for (ann of annotations; track $index) {
        @if (ann.type === 'text') {
          <foreignObject
            data-annotation="text"
            [attr.x]="asText(ann).x"
            [attr.y]="asText(ann).y"
            [attr.width]="asText(ann).width"
            [attr.height]="asText(ann).height"
            style="overflow:visible;"
          >
            <div xmlns="http://www.w3.org/1999/xhtml"
                 style="font-size:0.035px;white-space:pre-wrap;color:var(--color-text-primary);background:rgba(255,255,255,0.7);padding:0.003px 0.005px;border-radius:0.004px;">
              {{ asText(ann).text }}
            </div>
          </foreignObject>
        } @else {
          <polyline
            data-annotation="path"
            [attr.points]="toPointsAttr(asPath(ann).points)"
            fill="none"
            stroke="var(--color-accent)"
            stroke-width="0.004"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        }
      }
    </svg>
  `,
})
export class AnnotationOverlayComponent {
  @Input() annotations: Annotation[] = [];
  @Input() editable = false;

  asText(ann: Annotation): TextAnnotation {
    return ann as TextAnnotation;
  }

  asPath(ann: Annotation): PathAnnotation {
    return ann as PathAnnotation;
  }

  toPointsAttr(points: Array<[number, number]>): string {
    return points.map(([x, y]) => `${x},${y}`).join(' ');
  }
}
