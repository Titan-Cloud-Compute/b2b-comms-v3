import { Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  Crumb,
  FeError,
  FileExplorerApiService,
  FileItem,
  FileVersion,
  FolderItem,
  FolderListing,
  toFeError,
} from './file-explorer-api.service';

export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
export const BLOCKED_EXTENSIONS = ['exe', 'bat', 'cmd', 'com', 'msi', 'scr', 'pif', 'vbs', 'js', 'jar', 'ps1', 'sh', 'dll'];

/** Client-side mirror of the server's upload rules; returns an error message or null. */
export function checkUpload(file: File): string | null {
  if (file.size === 0) return `${file.name}: empty files cannot be uploaded`;
  if (file.size > MAX_UPLOAD_BYTES) return `${file.name}: file exceeds the 100 MB limit`;
  const ext = file.name.includes('.') ? (file.name.split('.').pop() ?? '').toLowerCase() : '';
  if (BLOCKED_EXTENSIONS.includes(ext)) return `${file.name}: .${ext} files are not allowed`;
  return null;
}

@Component({
  selector: 'app-file-explorer',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <section class="fe" data-testid="file-explorer">
      <a [routerLink]="['/projects', projectId()]">Back to project</a>
      <h1>Files</h1>

      <nav class="crumbs" data-testid="fe-breadcrumbs" aria-label="Breadcrumbs">
        @for (c of crumbs(); track $index; let last = $last) {
          @if (last) {
            <span aria-current="page">{{ c.name }}</span>
          } @else {
            <a [routerLink]="crumbLink(c)">{{ c.name }}</a> /
          }
        }
      </nav>

      <div class="toolbar">
        <input type="search" placeholder="Search by name" data-testid="fe-search" [(ngModel)]="query" (ngModelChange)="onSearch()" />
        <button type="button" data-testid="fe-view-toggle" (click)="toggleView()" [attr.aria-pressed]="view() === 'grid'">
          {{ view() === 'list' ? 'Grid view' : 'List view' }}
        </button>
        <form (ngSubmit)="createFolder()" class="new-folder">
          <input name="folderName" placeholder="New folder name" data-testid="fe-new-folder-name" [(ngModel)]="newFolderName" />
          <button type="submit" data-testid="fe-new-folder" [disabled]="busy()">Create folder</button>
        </form>
        <label class="upload">
          Upload files
          <input type="file" multiple data-testid="fe-upload-input" (change)="onFilesSelected($event)" [disabled]="busy()" />
        </label>
      </div>

      @if (progress() !== null) {
        <progress data-testid="fe-upload-progress" max="100" [value]="progress() ?? 0"></progress>
      }
      @if (error(); as e) {
        <div class="error" role="alert" data-testid="fe-error">
          {{ e.message }}
          @if (e.retryable && retryFn) {
            <button type="button" data-testid="fe-retry" (click)="retry()">Retry</button>
          }
        </div>
      }

      @if (loading()) {
        <p>Loading...</p>
      } @else {
        <ul [class]="view() === 'grid' ? 'items grid' : 'items list'" [attr.data-view]="view()" data-testid="fe-items">
          @for (f of folders(); track f.id) {
            <li class="item folder" data-testid="fe-folder">
              <a [routerLink]="['/projects', projectId(), 'files', f.id]">{{ f.name }}</a>
              <span class="actions">
                <button type="button" (click)="renameFolder(f)">Rename</button>
                <button type="button" (click)="moveFolder(f)">Move</button>
                <button type="button" (click)="deleteFolder(f)">Delete</button>
              </span>
            </li>
          }
          @for (f of files(); track f.id) {
            <li class="item file" data-testid="fe-file">
              <span class="name">{{ f.name }}</span>
              <span class="meta">{{ formatSize(f.size_bytes) }} · {{ f.mime_type }} · {{ f.uploaded_by_name || f.uploaded_by }} · {{ formatDate(f.uploaded_at) }} · v{{ f.version_number }}</span>
              <span class="actions">
                <button type="button" data-testid="fe-download" (click)="download(f)">Download</button>
                <button type="button" data-testid="fe-versions" (click)="showVersions(f)">Versions</button>
                <button type="button" (click)="renameFile(f)">Rename</button>
                <button type="button" (click)="moveFile(f)">Move</button>
                <button type="button" (click)="deleteFile(f)">Delete</button>
              </span>
            </li>
          }
          @if (!folders().length && !files().length) {
            <li class="empty" data-testid="fe-empty">No files or folders here.</li>
          }
        </ul>
      }

      @if (versionsFor(); as vf) {
        <aside class="versions" data-testid="fe-versions-panel">
          <h2>Versions of {{ vf.name }}</h2>
          <ul>
            @for (v of versions(); track v.id) {
              <li>v{{ v.version_number }} · {{ formatSize(v.size_bytes) }} · {{ v.uploaded_by_name || v.uploaded_by }} · {{ formatDate(v.uploaded_at) }}</li>
            }
          </ul>
          <button type="button" (click)="versionsFor.set(null)">Close</button>
        </aside>
      }
    </section>
  `,
  styles: [
    '.fe { padding: 1.5rem; display: flex; flex-direction: column; gap: 1rem; }',
    '.toolbar { display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: center; }',
    '.items { list-style: none; padding: 0; margin: 0; }',
    '.items.list .item { display: flex; gap: 1rem; padding: 0.5rem 0; border-bottom: 1px solid #e5e7eb; }',
    '.items.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr)); gap: 1rem; }',
    '.items.grid .item { display: flex; flex-direction: column; border: 1px solid #e5e7eb; border-radius: 0.5rem; padding: 0.75rem; }',
    '.meta { color: #6b7280; }',
    '.error { color: #b91c1c; }',
    '.versions { border: 1px solid #e5e7eb; border-radius: 0.5rem; padding: 1rem; }',
  ],
})
export class FileExplorerComponent implements OnInit {
  private api = inject(FileExplorerApiService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);

  projectId = signal('');
  folderId = signal<string | null>(null);
  view = signal<'list' | 'grid'>('list');
  crumbs = signal<Crumb[]>([{ id: null, name: 'Files' }]);
  folders = signal<FolderItem[]>([]);
  files = signal<FileItem[]>([]);
  loading = signal(false);
  busy = signal(false);
  progress = signal<number | null>(null);
  error = signal<FeError | null>(null);
  versionsFor = signal<FileItem | null>(null);
  versions = signal<FileVersion[]>([]);
  query = '';
  newFolderName = '';
  retryFn: (() => Promise<void>) | null = null;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  ngOnInit(): void {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((pm) => {
      this.projectId.set(pm.get('id') ?? '');
      this.folderId.set(pm.get('folderId'));
      void this.load();
    });
  }

  crumbLink(c: Crumb): unknown[] {
    return c.id ? ['/projects', this.projectId(), 'files', c.id] : ['/projects', this.projectId(), 'files'];
  }

  toggleView(): void {
    this.view.set(this.view() === 'list' ? 'grid' : 'list');
  }

  onSearch(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => void this.load(), 250);
  }

  async load(): Promise<void> {
    this.loading.set(true);
    try {
      const res: FolderListing = await this.api.list(this.projectId(), this.folderId(), this.query);
      this.crumbs.set(res.folder?.breadcrumbs?.length ? res.folder.breadcrumbs : [{ id: null, name: 'Files' }]);
      this.folders.set(res.folders ?? []);
      this.files.set(res.files ?? []);
      this.error.set(null);
    } catch (err) {
      this.fail(err, () => this.load());
    } finally {
      this.loading.set(false);
    }
  }

  async retry(): Promise<void> {
    const fn = this.retryFn;
    this.error.set(null);
    this.retryFn = null;
    if (fn) await fn();
  }

  private fail(err: unknown, again: () => Promise<void>): void {
    const e = toFeError(err);
    this.retryFn = e.retryable ? again : null;
    this.error.set(e);
  }

  /** Runs a mutating action, reloads on success and offers retry on 503. */
  private async run(action: () => Promise<unknown>): Promise<void> {
    this.busy.set(true);
    try {
      await action();
      this.error.set(null);
      this.retryFn = null;
      await this.load();
    } catch (err) {
      this.fail(err, () => this.run(action));
    } finally {
      this.busy.set(false);
    }
  }

  onFilesSelected(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const list = Array.from(input.files ?? []);
    input.value = '';
    if (!list.length) return;
    const problems = list.map(checkUpload).filter((m): m is string => !!m);
    if (problems.length) {
      this.error.set({ status: 400, message: problems.join('; '), retryable: false });
      this.retryFn = null;
      return;
    }
    void this.upload(list);
  }

  private async upload(list: File[]): Promise<void> {
    this.progress.set(0);
    await this.run(() => this.api.upload(this.projectId(), this.folderId(), list, (p) => this.progress.set(p)));
    this.progress.set(null);
  }

  async createFolder(): Promise<void> {
    const name = this.newFolderName.trim();
    if (!name) {
      this.error.set({ status: 400, message: 'Folder name must not be empty', retryable: false });
      return;
    }
    await this.run(() => this.api.createFolder(this.projectId(), name, this.folderId()));
    this.newFolderName = '';
  }

  private askName(current: string): string | null {
    const v = window.prompt('New name', current);
    return v && v.trim() ? v.trim() : null;
  }

  /** Destination folder id; blank means project root, null means cancelled. */
  private askTarget(): string | null | undefined {
    const v = window.prompt('Destination folder id (leave blank for project root)', '');
    if (v === null) return undefined;
    return v.trim() || null;
  }

  async renameFolder(f: FolderItem): Promise<void> {
    const name = this.askName(f.name);
    if (name) await this.run(() => this.api.updateFolder(f.id, { name }));
  }
  async moveFolder(f: FolderItem): Promise<void> {
    const target = this.askTarget();
    if (target !== undefined) await this.run(() => this.api.updateFolder(f.id, { parent_id: target }));
  }
  async deleteFolder(f: FolderItem): Promise<void> {
    if (window.confirm(`Delete folder "${f.name}"?`)) await this.run(() => this.api.deleteFolder(f.id));
  }
  async renameFile(f: FileItem): Promise<void> {
    const name = this.askName(f.name);
    if (name) await this.run(() => this.api.updateFile(f.id, { name }));
  }
  async moveFile(f: FileItem): Promise<void> {
    const target = this.askTarget();
    if (target !== undefined) await this.run(() => this.api.updateFile(f.id, { folder_id: target }));
  }
  async deleteFile(f: FileItem): Promise<void> {
    if (window.confirm(`Delete file "${f.name}"?`)) await this.run(() => this.api.deleteFile(f.id));
  }

  async showVersions(f: FileItem): Promise<void> {
    try {
      const res = await this.api.versions(f.id);
      this.versions.set(res.items ?? []);
      this.versionsFor.set(f);
    } catch (err) {
      this.fail(err, () => this.showVersions(f));
    }
  }

  async download(f: FileItem): Promise<void> {
    try {
      const res = await this.api.download(f.id);
      if (res?.url) window.open(res.url, '_blank', 'noopener');
    } catch (err) {
      this.fail(err, () => this.download(f));
    }
  }

  formatSize(bytes: number | null | undefined): string {
    const b = Number(bytes ?? 0);
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  }

  formatDate(iso: string | null | undefined): string {
    return iso ? new Date(iso).toLocaleString() : '';
  }

  /** Kept for template-free navigation (e.g. after deleting the open folder). */
  goRoot(): void {
    void this.router.navigate(['/projects', this.projectId(), 'files']);
  }
}
