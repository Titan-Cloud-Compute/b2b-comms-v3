/**
 * Types for the Message Reference and Annotation feature.
 * Mirrors the backend references view shape.
 */

export interface TextAnnotation {
  type: 'text';
  /** Normalised x coordinate (0..1). */
  x: number;
  /** Normalised y coordinate (0..1). */
  y: number;
  width: number;
  height: number;
  text: string;
}

export interface PathAnnotation {
  type: 'path';
  /** Array of [x, y] normalised coordinates (0..1). */
  points: Array<[number, number]>;
  stroke?: string;
  strokeWidth?: number;
}

export type Annotation = TextAnnotation | PathAnnotation;

export interface Reference {
  id: string;
  messageId: string;
  fileVersionId: string;
  pageNumber: number;
  annotations: Annotation[];
  authorId: string;
  /** Whether the current user may edit or delete this reference. */
  canEdit: boolean;
  /** False when the underlying file version has been deleted. */
  fileAvailable: boolean;
  /** Pre-signed URL for the page image. */
  pageUrl: string;
  fileName: string;
  updatedAt: string;
}
