/**
 * Annotation payload validation for the references feature.
 *
 * Each annotation is a discriminated union on `type`:
 *   - 'text': a text box with page-normalised coordinates
 *   - 'path': a freehand stroke with an array of page-normalised points
 *
 * All positional values (x, y, width, height, point coordinates) are numbers
 * in the range [0, 1], normalised to page dimensions.
 */

import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

/** Maximum allowed byte size for the full annotations payload. */
export const ANNOTATIONS_MAX_BYTES = 1_048_576; // 1 MB

/** Page-normalised coordinate: a number in [0, 1]. */
const NormCoord = z.number().min(0).max(1);

/** A text-box annotation. */
const TextAnnotationSchema = z.object({
  type: z.literal('text'),
  x: NormCoord,
  y: NormCoord,
  width: NormCoord,
  height: NormCoord,
  text: z.string().min(1).max(2000),
  color: z.string().optional(),
});

/** A single point in a freehand path. */
const PathPointSchema = z.object({
  x: NormCoord,
  y: NormCoord,
});

/** A freehand-stroke annotation. */
const PathAnnotationSchema = z.object({
  type: z.literal('path'),
  points: z.array(PathPointSchema).min(2).max(5000),
  color: z.string().optional(),
  strokeWidth: z.number().min(0.5).max(50).optional(),
});

/** Discriminated union of all annotation types. */
const AnnotationSchema = z.discriminatedUnion('type', [
  TextAnnotationSchema,
  PathAnnotationSchema,
]);

export type Annotation = z.infer<typeof AnnotationSchema>;

/** Array schema — used for internal parsing. */
const AnnotationsArraySchema = z.array(AnnotationSchema);

/**
 * Validate an unknown input as an array of Annotation objects.
 *
 * Throws `BadRequestException` when:
 *  - The serialised payload exceeds ANNOTATIONS_MAX_BYTES
 *  - The input does not conform to the schema
 *  - The parsed array is empty
 *
 * @returns The validated annotation array on success.
 */
export function validateAnnotations(input: unknown): Annotation[] {
  // 1. Size cap
  const byteLen = Buffer.byteLength(JSON.stringify(input));
  if (byteLen > ANNOTATIONS_MAX_BYTES) {
    throw new BadRequestException({
      message: 'Validation failed',
      errors: ['annotations exceeds 1 MB'],
    });
  }

  // 2. Schema validation
  const result = AnnotationsArraySchema.safeParse(input);
  if (!result.success) {
    const errors = result.error.issues.map(
      (issue) => `${issue.path.join('.')}: ${issue.message}`,
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
