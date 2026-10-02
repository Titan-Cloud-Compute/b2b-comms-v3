import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HttpClient, HttpErrorResponse, HttpEventType } from '@angular/common/http';
import { Subscription } from 'rxjs';

export interface ExplorerFile {
  id: string;
  name: string;
  sizeBytes: number;
  mimeType: string;
  uploader: string;
  uploadedAt: string | null;
  folderId: string | null;
}

export interface ExplorerFolder {
  id: string;
  name: string;
  parentId: string | null;
}

export interface FileVersion {
  id: string;
  versionNumber: number;
  sizeBytes: number;
  uploaderName: string | null;
  uploadedAt: string | null;
  current: boolean;
}

type Raw = Record<string, unknown>;

function str(v: unknown): string | null {
  if (typeof v === 'string' && v) return v;
  if (typeof v === 'number') return String(v);
  return null;
}

function normalizeFile(r: Raw): ExplorerFile {
  const cv = (r['current_version'] ?? r['currentVersion'] ?? {}) as Raw;
  const uploaderRaw = r['uploader'] ?? cv['uploader'];
  const uploaderObj = uploaderRaw && typeof uploaderRaw === 'object' ? (uploaderRaw as Raw) : null;
  return {
    id: str(r['id']) ?? '',
    name: str(r['name']) ?? '',
    sizeBytes: Number(r['sizeBytes'] ?? r['size_bytes'] ?? r['size'] ?? cv['size_bytes'] ?? 0) || 0,
    mimeType: str(r['mimeType']) ?? str(r['mime_type']) ?? str(r['type']) ?? '',
    uploader:
      str(r['uploaderName']) ??
      (uploaderObj ? str(uploaderObj['display_name']) ?? str(uploaderObj['name']) ?? str(uploaderObj['email']) : str(uploaderRaw)) ??
      str(r['uploadedBy']) ??
      str(r['uploaded_by']) ??
      '',
    uploadedAt: str(r['uploadedAt']) ?? str(r['uploaded_at']) ?? str(r['date']) ?? str(r['createdAt']) ?? str(cv['uploaded_at']),
    folderId: str(r['folderId']) ?? str(r['folder_id']),
  };
}

function normalizeFolder(r: Raw): ExplorerFolder {
  return {
    id: str(r['id']) ?? '',
    name: str(r['name']) ?? '',
    parentId: str(r['parentId']) ?? str(r['parent_id']),
  };
}

@Component({
  selector: 'app-file-explorer',
  standalone: true,
  imports: [FormsModule, RouterLink, DatePipe],
  template: `
    <div class="file-explorer" data-testid="file-explorer">
      <header class="fx-header">
        <h1>Files</h1>
        <nav class="fx-breadcrumbs" data-testid="breadcrumbs" aria-label="Breadcrumbs">
          <a [routerLink]="['/projects', projectId, 'files']" data-testid="breadcrumb-root">Root</a>
          @for (b of breadcrumbs(); track b.id) {
            <span aria-hidden="true">/</span>
            <a [routerLink]="['/projects', projectId, 'files', b.id]" data-testid="breadcrumb">{{ b.name }}</a>
          }
        </nav>
      </header>

      <div class="fx-toolbar">
        <input type="search" data-testid="file-search" placeholder="Search by name…" aria-label="Search files"
               [(ngModel)]="query" (ngModelChange)="onSearch()" />
        <button type="button" data-testid="view-toggle-list" [class.active]="view() === 'list'"
                [attr.aria-pressed]="view() === 'list'" (click)="setView('list')">List</button>
        <button type="button" data-testid="view-toggle-grid" [class.active]="view() === 'grid'"
                [attr.aria-pressed]="view() === 'grid'" (click)="setView('grid')">Grid</button>
        <button type="button" data-testid="new-folder" (click)="createFolder()">New folder</button>
        <label class="fx-upload">
          Upload
          <input type="file" multiple data-testid="file-upload-input" (change)="onFilesPicked($event)" />
        </label>
      </div>

      @if (uploadProgress() !== null) {
        <div class="fx-progress" data-testid="upload-progress">
          <progress max="100" [value]="uploadProgress() ?? 0"></progress> {{ uploadProgress() }}%
        </div>
      }

      @if (error()) {
        <div class="fx-error" role="alert" data-testid="file-explorer-error">
          {{ error() }}
          @if (retryable()) {
            <button type="button" data-testid="retry-action" (click)="retry()">Retry</button>
          }
        </div>
      }

      @if (loading()) {
        <p class="fx-muted">Loading…</p>
      }

      <div class="fx-items" [class.grid]="view() === 'grid'" [attr.data-view]="view()" data-testid="file-list">
        @if (view() === 'list') {
          <div class="fx-row fx-head" role="row">
            <span>Name</span><span>Size</span><span>Type</span><span>Uploader</span><span>Date</span><span></span>
          </div>
        }
        @for (f of folders(); track f.id) {
          <div class="fx-row fx-folder" data-testid="folder-row">
            <a [routerLink]="['/projects', projectId, 'files', f.id]">📁 {{ f.name }}</a>
            <span class="fx-actions">
              <button type="button" (click)="renameFolder(f)">Rename</button>
              <button type="button" (click)="moveFolder(f)">Move</button>
              <button type="button" (click)="deleteFolder(f)">Delete</button>
            </span>
          </div>
        }
        @for (f of files(); track f.id) {
          <div class="fx-row" data-testid="file-row">
            <span class="fx-name" data-testid="file-name">{{ f.name }}</span>
            <span data-testid="file-size">{{ formatSize(f.sizeBytes) }}</span>
            <span data-testid="file-type">{{ f.mimeType }}</span>
            <span data-testid="file-uploader">{{ f.uploader }}</span>
            <span data-testid="file-date">{{ f.uploadedAt ? (f.uploadedAt | date: 'mediumDate') : '' }}</span>
            <span class="fx-actions">
              <button type="button" data-testid="file-download" (click)="download(f)">Download</button>
              <button type="button" data-testid="file-versions" (click)="showVersions(f)">Versions</button>
              <button type="button" (click)="renameFile(f)">Rename</button>
              <button type="button" (click)="moveFile(f)">Move</button>
              <button type="button" (click)="deleteFile(f)">Delete</button>
            </span>
          </div>
        }
        @if (!loading() && files().length === 0 && folders().length === 0) {
          <p class="fx-muted" data-testid="file-explorer-empty">No files or folders here yet.</p>
        }
      </div>

      @if (versionsFor()) {
        <aside class="fx-versions" data-testid="version-panel">
          <h2>Versions of {{ versionsFor()!.name }}</h2>
          <button type="button" (click)="versionsFor.set(null)">Close</button>
          <ul>
            @for (v of versions(); track v.id) {
              <li>v{{ v.versionNumber }} · {{ formatSize(v.sizeBytes) }} · {{ v.uploaderName }}
                · {{ v.uploadedAt ? (v.uploadedAt | date: 'medium') : '' }} @if (v.current) { (current) }</li>
            }
          </ul>
        </aside>
      }
    </div>
  `,
  styles: [`
    .file-explorer { padding: 1.5rem 1rem; max-width: 1100px; margin: 0 auto; }
    .fx-breadcrumbs { display: flex; gap: .4rem; flex-wrap: wrap; margin: .5rem 0 1rem; }
    .fx-toolbar { display: flex; gap: .5rem; flex-wrap: wrap; align-items: center; margin-bottom: 1rem; }
    .fx-toolbar .active { font-weight: 600; }
    .fx-upload input { display: none; }
    .fx-upload { cursor: pointer; border: 1px solid currentColor; padding: .25rem .6rem; border-radius: 4px; }
    .fx-row { display: grid; grid-template-columns: 2fr 1fr 1fr 1fr 1fr auto; gap: .5rem; padding: .4rem 0; align-items: center; }
    .fx-folder { grid-template-columns: 1fr auto; }
    .fx-items.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 1rem; }
    .fx-items.grid .fx-row { display: flex; flex-direction: column; align-items: flex-start; border: 1px solid; border-radius: 6px; padding: .75rem; }
    .fx-actions { display: flex; gap: .25rem; flex-wrap: wrap; }
    .fx-error { margin-bottom: 1rem; }
    .fx-muted { opacity: .7; }
    .fx-versions { margin-top: 1.5rem; border-top: 1px solid; padding-top: 1rem; }
  `],
})
export class FileExplorerComponent implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private sub?: Subscription;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private lastAction: (() => void) | null = null;

  projectId = '';
  folderId: string | null = null;
  query = '';

  readonly view = signal<'list' | 'grid'>('list');
  readonly files = signal<ExplorerFile[]>([]);
  readonly folders = signal<ExplorerFolder[]>([]);
  readonly breadcrumbs = signal<{ id: string; name: string }[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly retryable = signal(false);
  readonly uploadProgress = signal<number | null>(null);
  readonly versionsFor = signal<ExplorerFile | null>(null);
  readonly versions = signal<FileVersion[]>([]);

  ngOnInit(): void {
    this.sub = this.route.paramMap.subscribe((pm) => {
      this.projectId = pm.get('id') ?? '';
      this.folderId = pm.get('folderId');
      this.load();
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
    if (this.searchTimer) clearTimeout(this.searchTimer);
  }

  setView(v: 'list' | 'grid'): void {
    this.view.set(v);
  }

  formatSize(bytes: number): string {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let n = bytes;
    let i = 0;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return `${n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
  }

  private handleError(err: unknown, retryAction: () => void): void {
    const e = err as HttpErrorResponse;
    const body = (e?.error ?? {}) as Raw;
    const msg = str(body['message']) ?? (Array.isArray(body['message']) ? (body['message'] as string[]).join(', ') : null);
    const retry = e?.status === 503 || body['retryable'] === true;
    this.error.set(msg ?? (retry ? 'Storage is temporarily unavailable.' : 'Something went wrong.'));
    this.retryable.set(retry);
    this.lastAction = retry ? retryAction : null;
  }

  private clearError(): void {
    this.error.set(null);
    this.retryable.set(false);
  }

  retry(): void {
    const action = this.lastAction;
    this.clearError();
    (action ?? (() => this.load()))();
  }

  load(): void {
    if (!this.projectId) return;
    this.loading.set(true);
    const params: Record<string, string> = {};
    if (this.folderId) params['folderId'] = this.folderId;
    if (this.query.trim()) params['q'] = this.query.trim();
    this.http.get<unknown>(`api/projects/${encodeURIComponent(this.projectId)}/files`, { params }).subscribe({
      next: (res) => {
        this.loading.set(false);
        this.clearError();
        const arr = Array.isArray(res) ? (res as Raw[]) : null;
        const obj = (arr ? {} : (res ?? {})) as Raw;
        const listed = obj['items'] ?? obj['data'];
        const items = arr ?? (Array.isArray(listed) ? (listed as Raw[]) : []);
        const fileRaws = Array.isArray(obj['files'])
          ? (obj['files'] as Raw[])
          : items.filter((i) => i && i['kind'] !== 'folder' && i['type'] !== 'folder');
        const folderRaws = Array.isArray(obj['folders'])
          ? (obj['folders'] as Raw[])
          : items.filter((i) => i && (i['kind'] === 'folder' || i['type'] === 'folder'));
        this.files.set(fileRaws.filter((f) => f && typeof f === 'object').map(normalizeFile));
        this.folders.set(folderRaws.filter((f) => f && typeof f === 'object').map(normalizeFolder));
        this.breadcrumbs.set(Array.isArray(obj['breadcrumbs']) ? (obj['breadcrumbs'] as { id: string; name: string }[]) : []);
      },
      error: (err) => {
        this.loading.set(false);
        this.handleError(err, () => this.load());
      },
    });
  }

  onSearch(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.load(), 250);
  }

  onFilesPicked(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const picked = input.files ? Array.from(input.files) : [];
    input.value = '';
    if (picked.length) this.upload(picked);
  }

  upload(picked: File[]): void {
    const form = new FormData();
    picked.forEach((f) => form.append('files', f, f.name));
    if (this.folderId) form.append('folderId', this.folderId);
    this.uploadProgress.set(0);
    this.http
      .post(`api/projects/${encodeURIComponent(this.projectId)}/files`, form, { reportProgress: true, observe: 'events' })
      .subscribe({
        next: (ev) => {
          if (ev.type === HttpEventType.UploadProgress && ev.total) {
            this.uploadProgress.set(Math.round((100 * ev.loaded) / ev.total));
          } else if (ev.type === HttpEventType.Response) {
            this.uploadProgress.set(null);
            this.load();
          }
        },
        error: (err) => {
          this.uploadProgress.set(null);
          this.handleError(err, () => this.upload(picked));
        },
      });
  }

  createFolder(): void {
    const name = prompt('Folder name');
    if (name === null) return;
    this.http
      .post(`api/projects/${encodeURIComponent(this.projectId)}/folders`, { name, parentId: this.folderId })
      .subscribe({ next: () => this.load(), error: (err) => this.handleError(err, () => this.load()) });
  }

  renameFolder(f: ExplorerFolder): void {
    const name = prompt('New folder name', f.name);
    if (name === null) return;
    this.http.patch(`api/folders/${f.id}`, { name })
      .subscribe({ next: () => this.load(), error: (err) => this.handleError(err, () => this.load()) });
  }

  moveFolder(f: ExplorerFolder): void {
    const target = prompt('Target folder id (leave empty for root)', '');
    if (target === null) return;
    this.http.patch(`api/folders/${f.id}`, { parentId: target.trim() || null })
      .subscribe({ next: () => this.load(), error: (err) => this.handleError(err, () => this.load()) });
  }

  deleteFolder(f: ExplorerFolder): void {
    if (!confirm(`Delete folder "${f.name}"?`)) return;
    this.http.delete(`api/folders/${f.id}`)
      .subscribe({ next: () => this.load(), error: (err) => this.handleError(err, () => this.load()) });
  }

  renameFile(f: ExplorerFile): void {
    const name = prompt('New file name', f.name);
    if (name === null) return;
    this.http.patch(`api/files/${f.id}`, { name })
      .subscribe({ next: () => this.load(), error: (err) => this.handleError(err, () => this.load()) });
  }

  moveFile(f: ExplorerFile): void {
    const target = prompt('Target folder id (leave empty for root)', '');
    if (target === null) return;
    this.http.patch(`api/files/${f.id}`, { folderId: target.trim() || null })
      .subscribe({ next: () => this.load(), error: (err) => this.handleError(err, () => this.load()) });
  }

  deleteFile(f: ExplorerFile): void {
    if (!confirm(`Delete "${f.name}"?`)) return;
    this.http.delete(`api/files/${f.id}`)
      .subscribe({ next: () => this.load(), error: (err) => this.handleError(err, () => this.load()) });
  }

  download(f: ExplorerFile): void {
    this.http.get<{ url?: string }>(`api/files/${f.id}/download`).subscribe({
      next: (res) => {
        if (res?.url) window.open(res.url, '_blank', 'noopener');
      },
      error: (err) => this.handleError(err, () => this.download(f)),
    });
  }

  showVersions(f: ExplorerFile): void {
    this.versionsFor.set(f);
    this.versions.set([]);
    this.http.get<unknown>(`api/files/${f.id}/versions`).subscribe({
      next: (res) => this.versions.set(Array.isArray(res) ? (res as FileVersion[]) : []),
      error: (err) => this.handleError(err, () => this.showVersions(f)),
    });
  }

  goRoot(): void {
    void this.router.navigate(['/projects', this.projectId, 'files']);
  }
}
