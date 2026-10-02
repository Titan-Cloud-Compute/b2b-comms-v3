import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
// Value imports (NOT `import type`) so Nest can inject them.
import { PrismaService } from '../../prisma/prisma.service';
import { MinioService } from '../../lib/integrations/minio.service';
import { type GcActor, canCreateChannel } from '../general-channels/general-channels.logic';
import {
  type ReferenceCreated,
  type ReferenceUpdated,
  type ReferenceView,
  isReferenceableMime,
  parseAnnotations,
  parsePageNumber,
} from './annotations.schema';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Tx = any;

export const UNSUPPORTED_FILE_MESSAGE = 'Only PDF and image files can be referenced';

export interface CreateReferenceInput {
  file_id?: unknown;
  file_version_id?: unknown;
  page_number?: unknown;
  annotations?: unknown;
}
export interface UpdateReferenceInput {
  page_number?: unknown;
  annotations?: unknown;
}

const iso = (d: unknown): string | null => (d ? new Date(d as string).toISOString() : null);

@Injectable()
export class ReferencesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: MinioService,
  ) {}

  private run<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return (this.prisma as any).runAsAdmin(fn);
  }

  async resolveActor(session: { userId?: string; role?: string } | undefined): Promise<GcActor> {
    if (!session?.userId) throw new UnauthorizedException('not authenticated');
    return this.run(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: session.userId } });
      const organizationId = user?.organizationId ?? null;
      let isExternal = false;
      if (organizationId) {
        const org = await tx.organizations.findUnique({ where: { id: organizationId } });
        isExternal = !!org && org.is_internal === false;
      }
      return { userId: session.userId!, role: String(session.role ?? user?.role ?? '').toUpperCase(), organizationId, isExternal };
    });
  }

  /** 404 when the project is missing, 403 when the actor is not a member. */
  private async assertProjectAccess(tx: Tx, actor: GcActor, projectId: string | null | undefined) {
    if (!projectId) throw new NotFoundException('Project does not exist');
    const project = await tx.projects.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Project does not exist');
    if (actor.isExternal && project.organization_id !== actor.organizationId) throw new ForbiddenException('Forbidden');
    if (!canCreateChannel(actor)) {
      const member = await tx.project_members.findFirst({ where: { project_id: projectId, user_id: actor.userId } });
      if (!member) throw new ForbiddenException('Forbidden');
    }
    return project;
  }

  /** Message → channel → project, with membership enforced. */
  private async loadMessage(tx: Tx, actor: GcActor, messageId: string) {
    const message = await tx.messages.findUnique({ where: { id: messageId } });
    if (!message || message.deleted_at) throw new NotFoundException('Message does not exist');
    const channel = message.channel_id ? await tx.channels.findUnique({ where: { id: message.channel_id } }) : null;
    if (!channel) throw new NotFoundException('Message does not exist');
    await this.assertProjectAccess(tx, actor, channel.project_id);
    return { message, channel };
  }

  private async loadReference(tx: Tx, actor: GcActor, referenceId: string) {
    const ref = await tx.references.findUnique({ where: { id: referenceId } });
    if (!ref) throw new NotFoundException('Reference does not exist');
    const message = ref.message_id ? await tx.messages.findUnique({ where: { id: ref.message_id } }) : null;
    const channel = message?.channel_id ? await tx.channels.findUnique({ where: { id: message.channel_id } }) : null;
    if (!channel) throw new NotFoundException('Reference does not exist');
    await this.assertProjectAccess(tx, actor, channel.project_id);
    return { ref, channel };
  }

  async create(actor: GcActor, messageId: string, body: CreateReferenceInput): Promise<ReferenceCreated> {
    const page = parsePageNumber(body.page_number ?? 1);
    if (page === null) throw new BadRequestException('page_number: must be a positive integer');
    const ann = parseAnnotations(body.annotations);
    if (!ann.ok) throw new BadRequestException(ann.error);
    return this.run(async (tx) => {
      const { message, channel } = await this.loadMessage(tx, actor, messageId);
      if (message.author_id !== actor.userId) throw new ForbiddenException('Only the message author can attach a reference');

      let version: any = null;
      let file: any = null;
      if (typeof body.file_version_id === 'string' && body.file_version_id) {
        version = await tx.file_versions.findUnique({ where: { id: body.file_version_id } });
        file = version?.file_id ? await tx.files.findUnique({ where: { id: version.file_id } }) : null;
      } else if (typeof body.file_id === 'string' && body.file_id) {
        file = await tx.files.findUnique({ where: { id: body.file_id } });
        version = file?.current_version_id ? await tx.file_versions.findUnique({ where: { id: file.current_version_id } }) : null;
      } else {
        throw new BadRequestException('file_version_id or file_id is required');
      }
      if (!file || file.deleted_at || !version) throw new BadRequestException('file: does not exist');
      if (file.project_id !== channel.project_id) throw new BadRequestException('file: must belong to the same project');
      if (!isReferenceableMime(file.mime_type)) throw new BadRequestException(UNSUPPORTED_FILE_MESSAGE);

      const existing = await tx.references.findFirst({ where: { message_id: messageId } });
      if (existing) throw new ConflictException('Message already has a reference');

      const row = await tx.references.create({
        data: {
          message_id: messageId,
          file_version_id: version.id,
          page_number: page,
          annotations: ann.value,
          author_id: actor.userId,
          updated_at: new Date(),
        },
      });
      return {
        id: row.id,
        message_id: row.message_id,
        file_version_id: row.file_version_id,
        page_number: row.page_number,
        annotations: row.annotations,
        author_id: row.author_id,
      };
    });
  }

  async get(actor: GcActor, referenceId: string): Promise<ReferenceView> {
    return this.run(async (tx) => {
      const { ref } = await this.loadReference(tx, actor, referenceId);
      const version = ref.file_version_id ? await tx.file_versions.findUnique({ where: { id: ref.file_version_id } }) : null;
      const file = version?.file_id ? await tx.files.findUnique({ where: { id: version.file_id } }) : null;
      return {
        id: ref.id,
        message_id: ref.message_id,
        file_version_id: ref.file_version_id,
        page_number: ref.page_number,
        annotations: ref.annotations,
        author_id: ref.author_id,
        file_available: !!(file && !file.deleted_at && version?.storage_key),
        can_edit: ref.author_id === actor.userId,
        mime_type: file?.mime_type ?? null,
        updated_at: iso(ref.updated_at),
      };
    });
  }

  async update(actor: GcActor, referenceId: string, body: UpdateReferenceInput): Promise<ReferenceUpdated> {
    return this.run(async (tx) => {
      const { ref } = await this.loadReference(tx, actor, referenceId);
      if (ref.author_id !== actor.userId) throw new ForbiddenException('Only the reference author can edit it');
      const page = body.page_number === undefined ? ref.page_number : parsePageNumber(body.page_number);
      if (page === null) throw new BadRequestException('page_number: must be a positive integer');
      const ann = parseAnnotations(body.annotations);
      if (!ann.ok) throw new BadRequestException(ann.error);
      const row = await tx.references.update({
        where: { id: ref.id },
        data: { page_number: page, annotations: ann.value, updated_at: new Date() },
      });
      return { id: row.id, page_number: row.page_number, annotations: row.annotations, updated_at: iso(row.updated_at)! };
    });
  }

  async remove(actor: GcActor, referenceId: string): Promise<{ id: string; deleted: true }> {
    return this.run(async (tx) => {
      const { ref } = await this.loadReference(tx, actor, referenceId);
      if (ref.author_id !== actor.userId) throw new ForbiddenException('Only the reference author can delete it');
      await tx.references.deleteMany({ where: { id: ref.id } });
      return { id: ref.id, deleted: true as const };
    });
  }

  /**
   * Page content for a file version. Images are single-page and served as-is;
   * PDFs are served as the stored document (the client opens it at the page).
   */
  async page(actor: GcActor, versionId: string, pageParam: string): Promise<{ content_type: string; body: Buffer }> {
    const page = parsePageNumber(pageParam);
    if (page === null) throw new BadRequestException('page: must be a positive integer');
    const { version, file } = await this.run(async (tx) => {
      const version = await tx.file_versions.findUnique({ where: { id: versionId } });
      if (!version) throw new NotFoundException('File version does not exist');
      const file = version.file_id ? await tx.files.findUnique({ where: { id: version.file_id } }) : null;
      if (!file) throw new NotFoundException('File version does not exist');
      await this.assertProjectAccess(tx, actor, file.project_id);
      return { version, file };
    });
    if (file.deleted_at || !version.storage_key) throw new NotFoundException('This file is no longer available');
    if (!isReferenceableMime(file.mime_type)) throw new BadRequestException(UNSUPPORTED_FILE_MESSAGE);
    const mime = String(file.mime_type).toLowerCase();
    if (mime.startsWith('image/') && page !== 1) throw new NotFoundException('Page does not exist');
    let body: Buffer;
    try {
      body = await this.storage.getObjectBuffer(version.storage_key);
    } catch {
      throw new ServiceUnavailableException({ message: 'File storage is unavailable', retryable: true });
    }
    return { content_type: mime, body };
  }
}
