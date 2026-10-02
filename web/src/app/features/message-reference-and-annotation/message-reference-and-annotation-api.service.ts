import { Injectable, inject } from '@angular/core';
import { ApiClient } from '../../shared/api/api-client.service';
import { ApiClient as BaseApiClient, MockApiClient } from '../../shared/api/api-client';
import { MOCK_PICKER_FILES, ensureReferenceMock } from './message-reference-and-annotation-mocks';

// Contract types for the Message Reference and Annotation story.
export interface Point { x: number; y: number }
export interface TextBox { x: number; y: number; width?: number; height?: number; text: string; color?: string }
export interface Drawing { points: Point[]; color?: string; width?: number }
export interface Annotations { text_boxes: TextBox[]; drawings: Drawing[] }
export interface ReferenceCreated {
  id: string; message_id: string; file_version_id: string; page_number: number; annotations: Annotations; author_id: string;
}
export interface ReferenceView extends ReferenceCreated {
  file_available: boolean; can_edit: boolean; mime_type?: string | null; updated_at?: string | null;
}
export interface ReferenceUpdated { id: string; page_number: number; annotations: Annotations; updated_at: string }
/** A project file as offered by the reference picker. */
export interface PickerFile { id: string; name: string; mime_type: string; version_id: string | null }

export const UNSUPPORTED_FILE_MESSAGE = 'Only PDF and image files can be referenced';

export function isReferenceable(mime: string | null | undefined): boolean {
  const m = String(mime ?? '').toLowerCase();
  return m === 'application/pdf' || m.startsWith('image/');
}

/** URL of the rendered page for a file version (served by the backend). */
export function pageImageUrl(fileVersionId: string, page: number): string {
  return `/api/file-versions/${encodeURIComponent(fileVersionId)}/pages/${page}`;
}

export function errorMessage(err: unknown, fallback = 'Something went wrong'): string {
  const e = err as { message?: string; error?: { message?: string | string[] }; body?: { message?: string | string[] } };
  const m = e?.error?.message ?? e?.body?.message ?? e?.message;
  return Array.isArray(m) ? m.join(', ') : m || fallback;
}

@Injectable({ providedIn: 'root' })
export class MessageReferenceApiService {
  private api = inject(ApiClient);
  private base = inject(BaseApiClient, { optional: true });

  private get mock(): boolean {
    return this.base instanceof MockApiClient;
  }

  private call<T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T> {
    if (this.base instanceof MockApiClient) {
      ensureReferenceMock(this.base, method, `/api/${path}`);
      return this.base.request<T>(`/api/${path}`, { method, body });
    }
    if (method === 'GET') return this.api.get<T>(path);
    if (method === 'PUT') return this.api.put<T>(path, body);
    if (method === 'DELETE') return this.api.delete<T>(path);
    return this.api.post<T>(path, body);
  }

  create(messageId: string, body: { file_version_id: string; page_number: number; annotations: Annotations }): Promise<ReferenceCreated> {
    return this.call('POST', `messages/${encodeURIComponent(messageId)}/reference`, body);
  }
  get(id: string): Promise<ReferenceView> {
    return this.call('GET', `references/${encodeURIComponent(id)}`);
  }
  update(id: string, body: { page_number: number; annotations: Annotations }): Promise<ReferenceUpdated> {
    return this.call('PUT', `references/${encodeURIComponent(id)}`, body);
  }
  remove(id: string): Promise<unknown> {
    return this.call('DELETE', `references/${encodeURIComponent(id)}`);
  }

  /** Project files for the picker (File Explorer endpoints), with each file's current version id. */
  async listFiles(projectId: string): Promise<PickerFile[]> {
    if (this.mock) return MOCK_PICKER_FILES.map((f) => ({ ...f }));
    const listing = await this.api.get<{ files?: { id: string; name: string; mime_type: string }[] }>(
      `projects/${encodeURIComponent(projectId)}/files`,
    );
    return (listing?.files ?? []).map((f) => ({ id: f.id, name: f.name, mime_type: f.mime_type, version_id: null }));
  }

  /** Latest version id of a file (pins the reference to exactly what the author saw). */
  async currentVersionId(file: PickerFile): Promise<string | null> {
    if (file.version_id || this.mock) return file.version_id;
    const res = await this.api.get<{ items?: { id: string; version_number: number }[] }>(
      `files/${encodeURIComponent(file.id)}/versions`,
    );
    const items = [...(res?.items ?? [])].sort((a, b) => b.version_number - a.version_number);
    return items[0]?.id ?? null;
  }
}
