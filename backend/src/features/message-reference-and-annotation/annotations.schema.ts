/**
 * Story: Message Reference and Annotation — annotation payload schema and
 * reference contract types. Coordinates are normalised to the page (0..1) so
 * the overlay scales with the rendered page image.
 */
import { z } from 'zod';

/** Annotation JSON larger than this (serialised, in bytes) is rejected with 400. */
export const MAX_ANNOTATIONS_BYTES = 1024 * 1024;

const coord = z.number().finite().min(0).max(1);

export const textBoxSchema = z
  .object({
    x: coord,
    y: coord,
    width: coord.optional(),
    height: coord.optional(),
    text: z.string().max(10_000),
    color: z.string().max(32).optional(),
  })
  .strict();

export const drawingSchema = z
  .object({
    points: z.array(z.object({ x: coord, y: coord }).strict()).min(2).max(20_000),
    color: z.string().max(32).optional(),
    width: z.number().finite().positive().max(100).optional(),
  })
  .strict();

export const annotationsSchema = z
  .object({
    text_boxes: z.array(textBoxSchema).max(1_000).default([]),
    drawings: z.array(drawingSchema).max(1_000).default([]),
  })
  .strict();

export type TextBox = z.infer<typeof textBoxSchema>;
export type Drawing = z.infer<typeof drawingSchema>;
export type Annotations = z.infer<typeof annotationsSchema>;

export const SUPPORTED_MIME_PREFIXES = ['image/'];
export const SUPPORTED_MIME_TYPES = ['application/pdf'];

/** Only PDF and image files can be referenced. */
export function isReferenceableMime(mime: string | null | undefined): boolean {
  const m = String(mime ?? '').toLowerCase();
  return SUPPORTED_MIME_TYPES.includes(m) || SUPPORTED_MIME_PREFIXES.some((p) => m.startsWith(p));
}

export type AnnotationsResult = { ok: true; value: Annotations } | { ok: false; error: string };

/** Validate an annotation payload: well-formed, at most 1 MB, and not empty. */
export function parseAnnotations(input: unknown): AnnotationsResult {
  if (input === undefined || input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'annotations: must be an object with text_boxes and drawings' };
  }
  let size: number;
  try {
    size = Buffer.byteLength(JSON.stringify(input), 'utf8');
  } catch {
    return { ok: false, error: 'annotations: not serialisable' };
  }
  if (size > MAX_ANNOTATIONS_BYTES) return { ok: false, error: 'annotations: payload exceeds 1 MB' };
  const parsed = annotationsSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: `annotations.${issue?.path.join('.') ?? ''}: ${issue?.message ?? 'invalid'}` };
  }
  if (parsed.data.text_boxes.length === 0 && parsed.data.drawings.length === 0) {
    return { ok: false, error: 'annotations: add at least one text box or drawing' };
  }
  return { ok: true, value: parsed.data };
}

/** Positive integer page number, or null when invalid. */
export function parsePageNumber(input: unknown): number | null {
  const n = typeof input === 'string' && input.trim() !== '' ? Number(input) : input;
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 100_000 ? n : null;
}

// Contract response shapes.
export interface ReferenceCreated {
  id: string;
  message_id: string;
  file_version_id: string;
  page_number: number;
  annotations: Annotations;
  author_id: string;
}
export interface ReferenceView extends ReferenceCreated {
  file_available: boolean;
  can_edit: boolean;
  mime_type: string | null;
  updated_at: string | null;
}
export interface ReferenceUpdated {
  id: string;
  page_number: number;
  annotations: Annotations;
  updated_at: string;
}
