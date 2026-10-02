/**
 * Zod schema and validation helper for annotation payloads stored in
 * references.annotations (jsonb).
 *
 * Each annotation is a discriminated union on `type`:
 *   - 'text'  — a positioned text box
 *   - 'path'  — a freehand stroke (sequence of points)
 *
 * All positional values (x, y, width, height and point coordinates) are
 * page-normalised, i.e. numbers in [0, 1].
 */

import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

/** Hard limit on the serialised byte length of the annotations JSON. */
export const ANNOTATIONS_MAX_BYTES = 1_048_576; // 1 MB

// ─── coordinate helper ───────────────────────────────────────────────────────

/** A single page-normalised coordinate: must be in [0, 1]. */
const NormCoord = z.number().min(0).max(1);

// ─── individual annotation shapes ────────────────────────────────────────────

const TextAnnotationSchema = z.object({
  type: z.literal('text'),
  x: NormCoord,
  y: NormCoord,
  width: NormCoord,
  height: NormCoord,
  /** Visible text content (1 – 2 000 characters). */
  text: z.string().min(1).max(2000),
  /** Optional CSS colour string (e.g. "#ff0000" or "rgba(0,0,0,0.8)"). */
  color: z.string().optional(),
});

const PointSchema = z.object({
  x: NormCoord,
  y: NormCoord,
});

const PathAnnotationSchema = z.object({
  type: z.literal('path'),
  /** At least 2, at most 5 000 points. */
  points: z.array(PointSchema).min(2).max(5000),
  /** Optional stroke colour. */
  color: z.string().optional(),
  /** Stroke width in logical units (0.5 – 50). */
  strokeWidth: z.number().min(0.5).max(50).optional(),
});

// ─── public types and schemas ─────────────────────────────────────────────────

export const AnnotationSchema = z.discriminatedUnion('type', [
  TextAnnotationSchema,
  PathAnnotationSchema,
]);

export type Annotation = z.infer<typeof AnnotationSchema>;

const AnnotationsArraySchema = z.array(AnnotationSchema);

// ─── validation helper ────────────────────────────────────────────────────────

/**
 * Validate an unknown value as an annotations array.
 *
 * Throws `BadRequestException` (HTTP 400) when:
 *  1. The serialised JSON exceeds {@link ANNOTATIONS_MAX_BYTES}.
 *  2. The value does not conform to the schema.
 *  3. The parsed array is empty (at least one annotation is required).
 *
 * @returns The validated `Annotation[]` when all checks pass.
 */
export function validateAnnotations(input: unknown): Annotation[] {
  // 1. Size guard — measure *before* parsing to avoid processing huge inputs
  const serialised = JSON.stringify(input);
  const byteLength = Buffer.byteLength(serialised, 'utf8');
  if (byteLength > ANNOTATIONS_MAX_BYTES) {
    throw new BadRequestException({
      message: 'Validation failed',
      errors: ['annotations exceeds 1 MB'],
    });
  }

  // 2. Schema validation
  const result = AnnotationsArraySchema.safeParse(input);
  if (!result.success) {
    const errors = result.error.issues.map(
      (issue) =>
        issue.path.length > 0
          ? `${issue.path.join('.')}: ${issue.message}`
          : issue.message,
    );
    throw new BadRequestException({ message: 'Validation failed', errors });
  }

  // 3. Non-empty guard
  if (result.data.length === 0) {
    throw new BadRequestException(
      'At least one text box or drawing is required',
    );
  }

  return result.data;
}
