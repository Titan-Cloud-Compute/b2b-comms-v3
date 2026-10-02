import { Injectable, inject } from '@angular/core';
import { ApiClient } from '../../shared/api/api-client.service';

export const UNSUPPORTED_FILE_MESSAGE = 'Only PDF and image files can be referenced';

export interface TextBoxAnnotation {
  type: 'text';
  x: number;
  y: number;
  text: string;
  color?: string;
}

export interface StrokeAnnotation {
  type: 'stroke';
  points: [number, number][];
  color?: string;
  width?: number;
}

export type Annotation = TextBoxAnnotation | StrokeAnnotation;

export interface ReferenceView {
  id: string;
  message_id: string;
  project_id: string | null;
  file_id: string | null;
  file_name: string | null;
  mime_type: string | null;
  file_version_id: string;
  page_number: number;
  annotations: Annotation[];
  author_id: string;
  updated_at: string;
  can_edit: boolean;
  file_available: boolean;
}

export interface ReferenceableFile {
  id: string;
  name: string;
  mimeType: string;
  currentVersionId: string | null;
}

export interface CreateReferenceBody {
  fileId: string;
  pageNumber: number;
  annotations: Annotation[];
}

export function isReferenceableMime(mime: string | null | undefined): boolean {
  const m = (mime ?? '').toLowerCase().trim();
  return m === 'application/pdf' || m.startsWith('image/');
}

/** Stable, clamped 0..1 coordinates. */
export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, Math.round(n * 10000) / 10000));
}

export function strokePoints(s: StrokeAnnotation): string {
  return s.points.map(([x, y]) => `${x},${y}`).join(' ');
}

type Raw = Record<string, unknown>;

function normalizeFile(r: Raw): ReferenceableFile {
  const s = (v: unknown) => (typeof v === 'string' ? v : '');
  return {
    id: s(r['id']),
    name: s(r['name']),
    mimeType: s(r['mimeType']) || s(r['mime_type']),
    currentVersionId: s(r['currentVersionId']) || s(r['current_version_id']) || null,
  };
}

@Injectable({ providedIn: 'root' })
export class ReferencesApi {
  private api = inject(ApiClient);

  async listFiles(projectId: string): Promise<ReferenceableFile[]> {
    const res = await this.api.get<{ files?: Raw[] } | Raw[]>(`projects/${encodeURIComponent(projectId)}/files`);
    const rows = Array.isArray(res) ? res : Array.isArray(res?.files) ? res.files : [];
    return rows.map(normalizeFile).filter((f) => !!f.id);
  }

  get(referenceId: string): Promise<ReferenceView> {
    return this.api.get<ReferenceView>(`references/${encodeURIComponent(referenceId)}`);
  }

  create(messageId: string, body: CreateReferenceBody): Promise<ReferenceView> {
    return this.api.post<ReferenceView>(`messages/${encodeURIComponent(messageId)}/reference`, body);
  }

  update(referenceId: string, annotations: Annotation[]): Promise<ReferenceView> {
    return this.api.put<ReferenceView>(`references/${encodeURIComponent(referenceId)}`, { annotations });
  }

  remove(referenceId: string): Promise<unknown> {
    return this.api.delete<unknown>(`references/${encodeURIComponent(referenceId)}`);
  }

  /** Page image as an object URL (credentials included). */
  async pageImageUrl(fileVersionId: string, page: number): Promise<string> {
    const blob = await this.api.getBlob(`file-versions/${encodeURIComponent(fileVersionId)}/pages/${page}`);
    return URL.createObjectURL(blob);
  }
}
