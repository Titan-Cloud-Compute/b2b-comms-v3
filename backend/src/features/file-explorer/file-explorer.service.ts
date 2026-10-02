import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
// Value imports (NOT `import type`) so Nest can inject them.
import { PrismaService } from '../../prisma/prisma.service';
import { MinioService } from '../../lib/integrations/minio.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Tx = any;

export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
export const DOWNLOAD_URL_TTL_SECONDS = 300;
export const BLOCKED_EXTENSIONS = [
  'exe', 'bat', 'cmd', 'com', 'msi', 'scr', 'pif', 'vbs', 'js', 'jar', 'ps1', 'sh', 'dll',
];

export interface FeActor {
  userId: string;
  role: string;
  organizationId: string | null;
  isExternal: boolean;
}

export interface UploadedBlob {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export interface FileDto {
  id: string;
  name: string;
  mime_type: string;
  size_bytes: number;
  uploaded_by: string | null;
  uploaded_by_name: string | null;
  uploaded_at: string | null;
  version_number: number;
  folder_id: string | null;
}

export function storageUnavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException({
    statusCode: 503,
    message: 'Storage service is unavailable. Please retry.',
    retryable: true,
  });
}

export function validateUpload(file: UploadedBlob): void {
  const name = (file.originalname ?? '').trim();
  if (!name) throw new BadRequestException('file name must not be empty');
  if (!file.size || file.size <= 0) throw new BadRequestException(`${name}: empty files cannot be uploaded`);
  if (file.size > MAX_UPLOAD_BYTES) throw new BadRequestException(`${name}: file exceeds the 100 MB limit`);
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  if (BLOCKED_EXTENSIONS.includes(ext)) throw new BadRequestException(`${name}: .${ext} files are not allowed`);
}

function canManage(actor: FeActor): boolean {
  return !actor.isExternal && (actor.role === 'ADMIN' || actor.role === 'MANAGER');
}

@Injectable()
export class FileExplorerService {
  private readonly logger = new Logger(FileExplorerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: MinioService,
  ) {}

  private run<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return (this.prisma as any).runAsAdmin(fn);
  }

  async resolveActor(session: { userId: string; role: string } | undefined): Promise<FeActor> {
    if (!session?.userId) throw new UnauthorizedException('not authenticated');
    return this.run(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: session.userId } });
      const organizationId = user?.organizationId ?? null;
      let isExternal = false;
      if (organizationId) {
        const org = await tx.organizations.findUnique({ where: { id: organizationId } });
        isExternal = !!org && org.is_internal === false;
      }
      return { userId: session.userId, role: String(session.role), organizationId, isExternal };
    });
  }

  /** 404 when the project is missing, 403 when the actor is not a member. */
  async assertProjectAccess(tx: Tx, actor: FeActor, projectId: string) {
    const project = await tx.projects.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Project does not exist');
    if (actor.isExternal && project.organization_id !== actor.organizationId) {
      throw new ForbiddenException('Forbidden');
    }
    if (!canManage(actor)) {
      const member = await tx.project_members.findFirst({ where: { project_id: projectId, user_id: actor.userId } });
      if (!member) throw new ForbiddenException('Forbidden');
    }
    return project;
  }

  private async loadFolder(tx: Tx, actor: FeActor, id: string) {
    const folder = await tx.folders.findUnique({ where: { id } });
    if (!folder || folder.deleted_at) throw new NotFoundException('Folder does not exist');
    await this.assertProjectAccess(tx, actor, folder.project_id);
    return folder;
  }

  private async loadFile(tx: Tx, actor: FeActor, id: string) {
    const file = await tx.files.findUnique({ where: { id } });
    if (!file || file.deleted_at) throw new NotFoundException('File does not exist');
    await this.assertProjectAccess(tx, actor, file.project_id);
    return file;
  }

  /** Folder must belong to the project (else 403); null means project root. */
  private async checkFolderInProject(tx: Tx, projectId: string, folderId: string | null | undefined) {
    if (!folderId) return null;
    const folder = await tx.folders.findUnique({ where: { id: folderId } });
    if (!folder || folder.deleted_at) throw new NotFoundException('Folder does not exist');
    if (folder.project_id !== projectId) throw new ForbiddenException('Folder is outside this project');
    return folder;
  }

  /** Human-readable uploader (display name, else email); null when unknown. */
  private async uploaderName(tx: Tx, userId: string | null | undefined): Promise<string | null> {
    if (!userId) return null;
    try {
      const u = await (tx as any).user?.findUnique?.({ where: { id: userId } });
      return (u?.displayName || u?.display_name || u?.email || null) as string | null;
    } catch {
      return null;
    }
  }

  private async toFileDto(tx: Tx, file: any): Promise<FileDto> {
    const v = file.current_version_id
      ? await tx.file_versions.findUnique({ where: { id: file.current_version_id } })
      : null;
    return {
      id: file.id,
      name: file.name ?? '',
      mime_type: file.mime_type ?? 'application/octet-stream',
      size_bytes: v?.size_bytes != null ? Number(v.size_bytes) : 0,
      uploaded_by: v?.uploaded_by ?? null,
      uploaded_by_name: await this.uploaderName(tx, v?.uploaded_by),
      uploaded_at: v?.uploaded_at ? new Date(v.uploaded_at).toISOString() : null,
      version_number: v?.version_number ?? 1,
      folder_id: file.folder_id ?? null,
    };
  }

  async list(actor: FeActor, projectId: string, folderId?: string | null, q?: string) {
    return this.run(async (tx) => {
      const project = await this.assertProjectAccess(tx, actor, projectId);
      const current = await this.checkFolderInProject(tx, projectId, folderId);
      const breadcrumbs: { id: string | null; name: string }[] = [];
      let cursor = current;
      const seen = new Set<string>();
      while (cursor && !seen.has(cursor.id)) {
        seen.add(cursor.id);
        breadcrumbs.unshift({ id: cursor.id, name: cursor.name ?? '' });
        cursor = cursor.parent_id ? await tx.folders.findUnique({ where: { id: cursor.parent_id } }) : null;
      }
      breadcrumbs.unshift({ id: null, name: project.name ?? 'Files' });
      const term = (q ?? '').trim().toLowerCase();
      const alive = (r: any) => !r.deleted_at;
      const byName = (r: any) => !term || String(r.name ?? '').toLowerCase().includes(term);
      // Search spans the whole project; browsing is scoped to the current folder.
      const scope = term ? { project_id: projectId } : { project_id: projectId, folder_id: current?.id ?? null };
      const folderScope = term ? { project_id: projectId } : { project_id: projectId, parent_id: current?.id ?? null };
      const folders = (await tx.folders.findMany({ where: folderScope })).filter(alive).filter(byName);
      const files = (await tx.files.findMany({ where: scope })).filter(alive).filter(byName);
      const fileDtos: FileDto[] = [];
      for (const f of files) fileDtos.push(await this.toFileDto(tx, f));
      return {
        folder: { id: current?.id ?? null, name: current?.name ?? project.name ?? 'Files', breadcrumbs },
        folders: folders
          .map((f: any) => ({ id: f.id, name: f.name ?? '', parent_id: f.parent_id ?? null }))
          .sort((a: any, b: any) => a.name.localeCompare(b.name)),
        files: fileDtos.sort((a, b) => a.name.localeCompare(b.name)),
      };
    });
  }

  async upload(actor: FeActor, projectId: string, folderId: string | null, uploads: UploadedBlob[]) {
    if (!uploads.length) throw new BadRequestException('files: at least one file is required');
    uploads.forEach(validateUpload);
    await this.run(async (tx) => {
      await this.assertProjectAccess(tx, actor, projectId);
      await this.checkFolderInProject(tx, projectId, folderId);
    });
    // Store blobs first: if storage is down nothing is written to the DB.
    const keys: string[] = [];
    try {
      for (const u of uploads) {
        const key = `projects/${projectId}/${randomUUID()}`;
        await this.storage.putObject(key, u.buffer, u.size, u.mimetype || 'application/octet-stream');
        keys.push(key);
      }
    } catch (err) {
      this.logger.warn(`storage upload failed: ${(err as Error).message}`);
      for (const k of keys) await this.storage.deleteObject(k).catch(() => undefined);
      throw storageUnavailable();
    }
    return this.run(async (tx) => {
      const out: FileDto[] = [];
      for (let i = 0; i < uploads.length; i++) {
        const u = uploads[i];
        const name = u.originalname.trim();
        const siblings = await tx.files.findMany({ where: { project_id: projectId, folder_id: folderId ?? null, name } });
        let file = siblings.find((f: any) => !f.deleted_at);
        let versionNumber = 1;
        if (file) {
          const versions = await tx.file_versions.findMany({ where: { file_id: file.id } });
          versionNumber = versions.reduce((m: number, v: any) => Math.max(m, v.version_number ?? 0), 0) + 1;
        } else {
          file = await tx.files.create({
            data: { project_id: projectId, folder_id: folderId ?? null, name, mime_type: u.mimetype || 'application/octet-stream' },
          });
        }
        const version = await tx.file_versions.create({
          data: {
            file_id: file.id,
            version_number: versionNumber,
            storage_key: keys[i],
            size_bytes: BigInt(u.size),
            uploaded_by: actor.userId,
            uploaded_at: new Date(),
          },
        });
        file = await tx.files.update({
          where: { id: file.id },
          data: { current_version_id: version.id, mime_type: u.mimetype || file.mime_type },
        });
        out.push(await this.toFileDto(tx, file));
      }
      return { items: out };
    });
  }

  async versions(actor: FeActor, fileId: string): Promise<{
    items: {
      id: string;
      version_number: number;
      size_bytes: number;
      uploaded_by: string | null;
      uploaded_by_name: string | null;
      uploaded_at: string | null;
    }[];
  }> {
    return this.run(async (tx) => {
      await this.loadFile(tx, actor, fileId);
      const rows = await tx.file_versions.findMany({ where: { file_id: fileId } });
      const names = new Map<string, string | null>();
      for (const v of rows as any[]) {
        if (v.uploaded_by && !names.has(v.uploaded_by)) names.set(v.uploaded_by, await this.uploaderName(tx, v.uploaded_by));
      }
      return {
        items: rows
          .map((v: any) => ({
            id: v.id,
            version_number: v.version_number ?? 1,
            size_bytes: v.size_bytes != null ? Number(v.size_bytes) : 0,
            uploaded_by: v.uploaded_by ?? null,
            uploaded_by_name: v.uploaded_by ? names.get(v.uploaded_by) ?? null : null,
            uploaded_at: v.uploaded_at ? new Date(v.uploaded_at).toISOString() : null,
          }))
          .sort((a: any, b: any) => b.version_number - a.version_number),
      };
    });
  }

  async download(actor: FeActor, fileId: string, versionId?: string) {
    const version = await this.run(async (tx) => {
      const file = await this.loadFile(tx, actor, fileId);
      const id = versionId || file.current_version_id;
      const v = id ? await tx.file_versions.findUnique({ where: { id } }) : null;
      if (!v || v.file_id !== file.id || !v.storage_key) throw new NotFoundException('File version does not exist');
      return v;
    });
    try {
      const url = await this.storage.getSignedUrl(version.storage_key, DOWNLOAD_URL_TTL_SECONDS);
      return { url, expires_in: DOWNLOAD_URL_TTL_SECONDS };
    } catch (err) {
      this.logger.warn(`presign failed: ${(err as Error).message}`);
      throw storageUnavailable();
    }
  }

  async updateFile(actor: FeActor, fileId: string, input: { name?: string; folder_id?: string | null }) {
    return this.run(async (tx) => {
      const file = await this.loadFile(tx, actor, fileId);
      const data: Record<string, unknown> = {};
      if (input.name !== undefined) data['name'] = input.name;
      if (input.folder_id !== undefined) {
        await this.checkFolderInProject(tx, file.project_id, input.folder_id);
        data['folder_id'] = input.folder_id;
      }
      const updated = await tx.files.update({ where: { id: fileId }, data });
      return { id: updated.id, name: updated.name, folder_id: updated.folder_id ?? null };
    });
  }

  async deleteFile(actor: FeActor, fileId: string): Promise<void> {
    await this.run(async (tx) => {
      await this.loadFile(tx, actor, fileId);
      await tx.files.update({ where: { id: fileId }, data: { deleted_at: new Date() } });
    });
  }

  async createFolder(actor: FeActor, projectId: string, input: { name: string; parent_id?: string | null }) {
    return this.run(async (tx) => {
      await this.assertProjectAccess(tx, actor, projectId);
      await this.checkFolderInProject(tx, projectId, input.parent_id);
      const f = await tx.folders.create({
        data: { project_id: projectId, parent_id: input.parent_id ?? null, name: input.name, created_by: actor.userId },
      });
      return { id: f.id, name: f.name, parent_id: f.parent_id ?? null };
    });
  }

  async updateFolder(actor: FeActor, folderId: string, input: { name?: string; parent_id?: string | null }) {
    return this.run(async (tx) => {
      const folder = await this.loadFolder(tx, actor, folderId);
      const data: Record<string, unknown> = {};
      if (input.name !== undefined) data['name'] = input.name;
      if (input.parent_id !== undefined) {
        let cursor = await this.checkFolderInProject(tx, folder.project_id, input.parent_id);
        while (cursor) {
          if (cursor.id === folderId) throw new BadRequestException('parent_id: cannot move a folder into itself');
          cursor = cursor.parent_id ? await tx.folders.findUnique({ where: { id: cursor.parent_id } }) : null;
        }
        data['parent_id'] = input.parent_id;
      }
      const updated = await tx.folders.update({ where: { id: folderId }, data });
      return { id: updated.id, name: updated.name, parent_id: updated.parent_id ?? null };
    });
  }

  async deleteFolder(actor: FeActor, folderId: string): Promise<void> {
    await this.run(async (tx) => {
      await this.loadFolder(tx, actor, folderId);
      await tx.folders.update({ where: { id: folderId }, data: { deleted_at: new Date() } });
    });
  }
}
