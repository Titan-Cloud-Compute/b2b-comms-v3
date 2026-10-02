import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

const ONE_MB = 1024 * 1024;

/** Minimal per-annotation shape: type + any extra fields are allowed. */
const annotationItemSchema = z
  .object({ type: z.enum(['text', 'drawing']) })
  .passthrough();

/** Top-level annotations must be a non-empty array of valid items. */
export const annotationsSchema = z
  .array(annotationItemSchema)
  .min(1, 'annotations must not be empty');

export type Annotations = z.infer<typeof annotationsSchema>;

/**
 * Validate the annotations payload, enforcing:
 *  - non-empty array
 *  - each item has a valid `type`
 *  - total JSON size ≤ 1 MB
 * Throws BadRequestException on failure.
 */
export function validateAnnotations(annotations: unknown): Annotations {
  const json = JSON.stringify(annotations ?? null);
  if (json.length > ONE_MB) {
    throw new BadRequestException('annotations exceed 1 MB limit');
  }
  const result = annotationsSchema.safeParse(annotations);
  if (!result.success) {
    throw new BadRequestException(
      result.error.issues.map((i) => i.message).join('; ') || 'invalid annotations',
    );
  }
  return result.data;
}
