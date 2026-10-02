/**
 * Types for the Message Reference and Annotation feature.
 * Mirrors the server-side view shape returned by GET /api/references/:id.
 */

export type AnnotationType = 'text' | 'path';

export interface TextAnnotation {
  type: 'text';
  /** Normalised x coordinate (0–1) from left edge. */
  x: number;
  /** Normalised y coordinate (0–1) from top edge. */
  y: number;
  /** Normalised width (0–1). */
  width: number;
  /** Normalised height (0–1). */
  height: number;
  text: string;
}

export interface PathAnnotation {
  type: 'path';
  /** Array of [x, y] points, each normalised to 0–1. */
  points: Array<[number, number]>;
}

export type Annotation = TextAnnotation | PathAnnotation;

export interface Reference {
  id: string;
  message_id: string;
  file_version_id: string;
  page_number: number;
  annotations: Annotation[];
  /** Viewer may edit/delete if true. */
  can_edit: boolean;
  /** False when the original file has been deleted. */
  file_available: boolean;
  /** URL to the rendered page image (GET /api/file-versions/:id/pages/:page). */
  page_url: string;
  file_name: string;
  updated_at: string;
}
