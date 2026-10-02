import { z } from 'zod';

/** Annotation payloads (JSON-encoded) may not exceed 1 MB. */
export const MAX_ANNOTATIONS_BYTES = 1024 * 1024;

/** Coordinates are normalised to the page: 0..1 on both axes. */
const coord = z.number().finite().min(0).max(1);

export const textBoxSchema = z
  .object({
    type: z.literal('text'),
    x: coord,
    y: coord,
    text: z.string().min(1).max(2000),
    color: z.string().max(32).optional(),
  })
  .strict();

export const strokeSchema = z
  .object({
    type: z.literal('stroke'),
    points: z.array(z.tuple([coord, coord])).min(1).max(10000),
    color: z.string().max(32).optional(),
    width: z.number().finite().min(0.5).max(50).optional(),
  })
  .strict();

export const annotationSchema = z.discriminatedUnion('type', [textBoxSchema, strokeSchema]);

export const annotationsSchema = z.array(annotationSchema).min(1, 'at least one text box or drawing is required').max(5000);

export type Annotation = z.infer<typeof annotationSchema>;

export type AnnotationsResult = { ok: true; value: Annotation[] } | { ok: false; error: string };

/** Validates an annotations payload: shape, non-empty, and the 1 MB size cap. */
export function parseAnnotations(input: unknown): AnnotationsResult {
  let size: number;
  try {
    size = Buffer.byteLength(JSON.stringify(input ?? null), 'utf8');
  } catch {
    return { ok: false, error: 'annotations must be valid JSON' };
  }
  if (size > MAX_ANNOTATIONS_BYTES) return { ok: false, error: 'annotations exceed the 1 MB limit' };
  const parsed = annotationsSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path?.length ? `${issue.path.join('.')}: ` : '';
    return { ok: false, error: `invalid annotations: ${path}${issue?.message ?? 'malformed'}` };
  }
  return { ok: true, value: parsed.data };
}

export const createReferenceSchema = z.object({
  fileId: z.string().min(1),
  pageNumber: z.number().int().min(1).max(100000).optional(),
  annotations: z.unknown(),
});
