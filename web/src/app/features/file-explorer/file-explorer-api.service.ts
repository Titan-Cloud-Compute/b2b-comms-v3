import { HttpClient, HttpErrorResponse, HttpEventType } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { ApiClient } from '../../shared/api/api-client.service';
import { ApiClient as BaseApiClient, MockApiClient } from '../../shared/api/api-client';
import { ensureFileExplorerMock } from './file-explorer-mocks';

// Contract types for the File Explorer story (mirrors the card's endpoint
// contract; @contracts has no web-side slug yet).
export interface Crumb { id: string | null; name: string }
export interface FolderItem { id: string; name: string; parent_id?: string | null }
export interface FileItem {
  id: string;
  name: string;
  mime_type: string;
  size_bytes: number;
  uploaded_by: string | null;
  uploaded_at: string | null;
  version_number: number;
  folder_id?: string | null;
}
export interface FolderListing {
  folder: { id: string | null; name: string; breadcrumbs: Crumb[] };
  folders: FolderItem[];
  files: FileItem[];
}
export interface FileVersion {
  id: string;
  version_number: number;
  size_bytes: number;
  uploaded_by: string | null;
  uploaded_at: string | null;
}

/** Normalised failure: HTTP status, message and the server's retryable flag. */
export interface FeError { status: number; message: string; retryable: boolean }

export function toFeError(err: unknown): FeError {
  const e = err as { status?: number; message?: string; body?: unknown; error?: unknown };
  const body = (e?.body ?? e?.error ?? {}) as { message?: unknown; retryable?: unknown };
  const status = typeof e?.status === 'number' ? e.status : 0;
  const msg = Array.isArray(body.message) ? body.message.join(', ') : (body.message as string | undefined);
  return {
    status,
    message: msg || e?.message || 'Request failed',
    retryable: body.retryable === true || status === 503,
  };
}

@Injectable({ providedIn: 'root' })
export class FileExplorerApiService {
  private api = inject(ApiClient);
  private httpClient = inject(HttpClient);
  private base = inject(BaseApiClient, { optional: true });

  private call<T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
    if (this.base instanceof MockApiClient) {
      ensureFileExplorerMock(this.base, method, `/api/${path}`);
      return this.base.request<T>(`/api/${path}`, { method, body });
    }
    if (method === 'GET') return this.api.get<T>(path);
    if (method === 'PATCH') return this.api.patch<T>(path, body);
    if (method === 'DELETE') return this.api.delete<T>(path);
    return this.api.post<T>(path, body);
  }

  list(projectId: string, folderId: string | null, q: string): Promise<FolderListing> {
    const qs = new URLSearchParams();
    if (folderId) qs.set('folder_id', folderId);
    if (q.trim()) qs.set('q', q.trim());
    const suffix = qs.toString() ? `?${qs}` : '';
    return this.call('GET', `projects/${encodeURIComponent(projectId)}/files${suffix}`);
  }
  createFolder(projectId: string, name: string, parentId: string | null): Promise<FolderItem> {
    return this.call('POST', `projects/${encodeURIComponent(projectId)}/folders`, { name, parent_id: parentId });
  }
  updateFolder(id: string, body: { name?: string; parent_id?: string | null }): Promise<FolderItem> {
    return this.call('PATCH', `folders/${encodeURIComponent(id)}`, body);
  }
  deleteFolder(id: string): Promise<unknown> {
    return this.call('DELETE', `folders/${encodeURIComponent(id)}`);
  }
  updateFile(id: string, body: { name?: string; folder_id?: string | null }): Promise<FileItem> {
    return this.call('PATCH', `files/${encodeURIComponent(id)}`, body);
  }
  deleteFile(id: string): Promise<unknown> {
    return this.call('DELETE', `files/${encodeURIComponent(id)}`);
  }
  versions(id: string): Promise<{ items: FileVersion[] }> {
    return this.call('GET', `files/${encodeURIComponent(id)}/versions`);
  }
  download(id: string): Promise<{ url: string; expires_in: number }> {
    return this.call('GET', `files/${encodeURIComponent(id)}/download`);
  }

  /** Multipart upload reporting progress (0-100) through `onProgress`. */
  upload(projectId: string, folderId: string | null, files: File[], onProgress: (pct: number) => void): Promise<unknown> {
    const path = `projects/${encodeURIComponent(projectId)}/files`;
    if (this.base instanceof MockApiClient) {
      onProgress(100);
      return this.call('POST', path);
    }
    const form = new FormData();
    for (const f of files) form.append('files', f, f.name);
    if (folderId) form.append('folder_id', folderId);
    return new Promise((resolve, reject) => {
      this.httpClient
        .post(this.api.url(path), form, { withCredentials: true, reportProgress: true, observe: 'events' })
        .subscribe({
          next: (ev) => {
            if (ev.type === HttpEventType.UploadProgress && ev.total) onProgress(Math.round((100 * ev.loaded) / ev.total));
            if (ev.type === HttpEventType.Response) resolve(ev.body);
          },
          error: (err: unknown) =>
            reject(err instanceof HttpErrorResponse ? { status: err.status, error: err.error, message: err.message } : err),
        });
    });
  }
}
