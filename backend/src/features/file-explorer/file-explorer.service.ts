import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { MinioService } from '../../lib/integrations/minio.service';

export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
export const DOWNLOAD_URL_EXPIRY_SECONDS = 300;
export const BLOCKED_EXTENSIONS = ['exe', 'bat', 'cmd', 'com', 'msi', 'scr', 'js', 'vbs', 'ps1', 'sh', 'jar', 'dll'];
export const BLOCKED_MIME_TYPES = [
  'application/x-msdownload',
  'application/x-msdos-program',
  'application/x-sh',
  'application/x-executable',
  'application/java-archive',
];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface UploadInput {
  originalname: string;
  mimetype?: string;
  size: number;
  buffer: Buffer;
}

export class StorageUnavailableException extends HttpException {
  constructor() {
    super(
      { statusCode: 503, message: 'File storage is temporarily unavailable', retryable: true },
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}

function serializeFile(f: {
  id: string;
  project_id: string;
  folder_id: string | null;
  name: string;
  mime_type: string;
  current_version_id: string | null;
  current_version?: {
    version_number: number;
    size_bytes: bigint;
    uploaded_at: Date;
    uploaded_by: string;
    uploader?: { display_name: string | null; name: string | null; email: string } | null;
  } | null;
}) {
  const v = f.current_version ?? null;
  return {
    id: f.id,
    kind: 'file' as const,
    projectId: f.project_id,
    folderId: f.folder_id,
    name: f.name,
    mimeType: f.mime_type,
    currentVersionId: f.current_version_id,
    versionNumber: v?.version_number ?? null,
    sizeBytes: v ? Number(v.size_bytes) : 0,
    uploadedAt: v?.uploaded_at ?? null,
    uploadedBy: v?.uploaded_by ?? null,
    uploaderName: v?.uploader ? v.uploader.display_name || v.uploader.name || v.uploader.email : null,
  };
}

const VERSION_INCLUDE = {
  current_version: {
    include: { uploader: { select: { display_name: true, name: true, email: true } } },
  },
} as const;

@Injectable()
export class FileExplorerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly minio: MinioService,
  ) {}

  async assertMember(projectId: string, userId: string | undefined): Promise<void> {
    if (!userId || !UUID_RE.test(projectId)) throw new ForbiddenException('not a project member');
    const member = await this.prisma.project_members.findUnique({
      where: { project_id_user_id: { project_id: projectId, user_id: userId } },
    });
    if (!member) throw new ForbiddenException('not a project member');
  }

  private async loadFolder(folderId: string, userId: string | undefined) {
    if (!UUID_RE.test(folderId)) throw new NotFoundException('folder not found');
    const folder = await this.prisma.folders.findFirst({ where: { id: folderId, deleted_at: null } });
    if (!folder) throw new NotFoundException('folder not found');
    await this.assertMember(folder.project_id, userId);
    return folder;
  }

  private async loadFile(fileId: string, userId: string | undefined) {
    if (!UUID_RE.test(fileId)) throw new NotFoundException('file not found');
    const file = await this.prisma.files.findFirst({ where: { id: fileId, deleted_at: null } });
    if (!file) throw new NotFoundException('file not found');
    await this.assertMember(file.project_id, userId);
    return file;
  }

  private async assertFolderInProject(folderId: string | null | undefined, projectId: string) {
    if (!folderId) return;
    const folder = await this.prisma.folders.findFirst({ where: { id: folderId, deleted_at: null } });
    if (!folder) throw new NotFoundException('folder not found');
    if (folder.project_id !== projectId) throw new ForbiddenException('folder is outside this project');
  }

  async list(projectId: string, userId: string | undefined, folderId?: string | null, q?: string) {
    await this.assertMember(projectId, userId);
    const search = (q ?? '').trim();
    const nameFilter = search ? { name: { contains: search, mode: 'insensitive' as const } } : {};
    // Search spans the whole project; otherwise list the current folder only.
    const scope = search ? {} : { folder_id: folderId || null };
    const folderScope = search ? {} : { parent_id: folderId || null };
    const [folders, files] = await Promise.all([
      this.prisma.folders.findMany({
        where: { project_id: projectId, deleted_at: null, ...folderScope, ...nameFilter },
        orderBy: { name: 'asc' },
      }),
      this.prisma.files.findMany({
        where: { project_id: projectId, deleted_at: null, ...scope, ...nameFilter },
        include: VERSION_INCLUDE,
        orderBy: { name: 'asc' },
      }),
    ]);
    const breadcrumbs: { id: string; name: string }[] = [];
    let cursor = folderId || null;
    let guard = 0;
    while (cursor && guard++ < 50) {
      const f = await this.prisma.folders.findFirst({ where: { id: cursor, project_id: projectId } });
      if (!f) break;
      breadcrumbs.unshift({ id: f.id, name: f.name });
      cursor = f.parent_id;
    }
    return {
      folderId: folderId || null,
      breadcrumbs,
      folders: folders.map((f) => ({
        id: f.id,
        kind: 'folder' as const,
        name: f.name,
        parentId: f.parent_id,
        projectId: f.project_id,
      })),
      files: files.map(serializeFile),
    };
  }

  validateUpload(file: UploadInput | undefined): void {
    if (!file) throw new BadRequestException('no file provided');
    const name = (file.originalname ?? '').trim();
    if (!name) throw new BadRequestException('file name is required');
    if (!file.size || file.size <= 0) throw new BadRequestException(`"${name}" is empty (0 bytes)`);
    if (file.size > MAX_UPLOAD_BYTES) throw new BadRequestException(`"${name}" exceeds the 100 MB limit`);
    const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
    if (BLOCKED_EXTENSIONS.includes(ext) || BLOCKED_MIME_TYPES.includes((file.mimetype ?? '').toLowerCase())) {
      throw new BadRequestException(`"${name}" is a blocked file type`);
    }
  }

  async upload(projectId: string, userId: string | undefined, folderId: string | null, uploads: UploadInput[]) {
    await this.assertMember(projectId, userId);
    if (!uploads || uploads.length === 0) throw new BadRequestException('no file provided');
    uploads.forEach((u) => this.validateUpload(u));
    await this.assertFolderInProject(folderId, projectId);

    const results: ReturnType<typeof serializeFile>[] = [];
    for (const u of uploads) {
      const name = u.originalname.trim();
      const mime = u.mimetype || 'application/octet-stream';
      const storageKey = `projects/${projectId}/${randomUUID()}`;
      // Store the object first so storage failure leaves no partial DB rows.
      try {
        await this.minio.putObject(storageKey, u.buffer, u.size, mime);
      } catch {
        throw new StorageUnavailableException();
      }
      try {
        const saved = await this.prisma.$transaction(async (tx) => {
          const existing = await tx.files.findFirst({
            where: { project_id: projectId, folder_id: folderId || null, name, deleted_at: null },
            include: { versions: { orderBy: { version_number: 'desc' }, take: 1 } },
          });
          const file =
            existing ??
            (await tx.files.create({
              data: { project_id: projectId, folder_id: folderId || null, name, mime_type: mime },
              include: { versions: { orderBy: { version_number: 'desc' }, take: 1 } },
            }));
          const nextNumber = (file.versions[0]?.version_number ?? 0) + 1;
          const version = await tx.file_versions.create({
            data: {
              file_id: file.id,
              version_number: nextNumber,
              storage_key: storageKey,
              size_bytes: BigInt(u.size),
              uploaded_by: userId!,
            },
          });
          return tx.files.update({
            where: { id: file.id },
            data: { current_version_id: version.id, mime_type: mime },
            include: VERSION_INCLUDE,
          });
        });
        results.push(serializeFile(saved));
      } catch (err) {
        await this.minio.deleteObject(storageKey).catch(() => undefined);
        throw err;
      }
    }
    return { files: results };
  }

  async download(fileId: string, userId: string | undefined) {
    const file = await this.loadFile(fileId, userId);
    if (!file.current_version_id) throw new NotFoundException('file has no stored version');
    const version = await this.prisma.file_versions.findUnique({ where: { id: file.current_version_id } });
    if (!version) throw new NotFoundException('file has no stored version');
    let url: string;
    try {
      url = await this.minio.getSignedUrl(version.storage_key, DOWNLOAD_URL_EXPIRY_SECONDS);
    } catch {
      throw new StorageUnavailableException();
    }
    return { url, expiresIn: DOWNLOAD_URL_EXPIRY_SECONDS, name: file.name };
  }

  async versions(fileId: string, userId: string | undefined) {
    const file = await this.loadFile(fileId, userId);
    const rows = await this.prisma.file_versions.findMany({
      where: { file_id: file.id },
      orderBy: { version_number: 'desc' },
      include: { uploader: { select: { display_name: true, name: true, email: true } } },
    });
    return rows.map((v) => ({
      id: v.id,
      versionNumber: v.version_number,
      sizeBytes: Number(v.size_bytes),
      uploadedBy: v.uploaded_by,
      uploaderName: v.uploader ? v.uploader.display_name || v.uploader.name || v.uploader.email : null,
      uploadedAt: v.uploaded_at,
      current: v.id === file.current_version_id,
    }));
  }

  async updateFile(fileId: string, userId: string | undefined, body: { name?: string; folderId?: string | null }) {
    const file = await this.loadFile(fileId, userId);
    const data: { name?: string; folder_id?: string | null } = {};
    if (body.name !== undefined) {
      const name = String(body.name ?? '').trim();
      if (!name) throw new BadRequestException('name must not be empty');
      data.name = name;
    }
    if (body.folderId !== undefined) {
      await this.assertFolderInProject(body.folderId, file.project_id);
      data.folder_id = body.folderId || null;
    }
    const saved = await this.prisma.files.update({ where: { id: file.id }, data, include: VERSION_INCLUDE });
    return serializeFile(saved);
  }

  async deleteFile(fileId: string, userId: string | undefined): Promise<void> {
    const file = await this.loadFile(fileId, userId);
    await this.prisma.files.update({ where: { id: file.id }, data: { deleted_at: new Date() } });
  }

  async createFolder(projectId: string, userId: string | undefined, body: { name?: string; parentId?: string | null }) {
    await this.assertMember(projectId, userId);
    const name = String(body?.name ?? '').trim();
    if (!name) throw new BadRequestException('folder name must not be empty');
    await this.assertFolderInProject(body?.parentId, projectId);
    const f = await this.prisma.folders.create({
      data: { project_id: projectId, parent_id: body?.parentId || null, name, created_by: userId! },
    });
    return { id: f.id, kind: 'folder' as const, name: f.name, parentId: f.parent_id, projectId: f.project_id };
  }

  async updateFolder(folderId: string, userId: string | undefined, body: { name?: string; parentId?: string | null }) {
    const folder = await this.loadFolder(folderId, userId);
    const data: { name?: string; parent_id?: string | null } = {};
    if (body.name !== undefined) {
      const name = String(body.name ?? '').trim();
      if (!name) throw new BadRequestException('folder name must not be empty');
      data.name = name;
    }
    if (body.parentId !== undefined) {
      if (body.parentId === folder.id) throw new BadRequestException('a folder cannot contain itself');
      await this.assertFolderInProject(body.parentId, folder.project_id);
      data.parent_id = body.parentId || null;
    }
    const f = await this.prisma.folders.update({ where: { id: folder.id }, data });
    return { id: f.id, kind: 'folder' as const, name: f.name, parentId: f.parent_id, projectId: f.project_id };
  }

  async deleteFolder(folderId: string, userId: string | undefined): Promise<void> {
    const folder = await this.loadFolder(folderId, userId);
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.files.updateMany({ where: { folder_id: folder.id, deleted_at: null }, data: { deleted_at: now } }),
      this.prisma.folders.update({ where: { id: folder.id }, data: { deleted_at: now } }),
    ]);
  }
}
