import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { createReferenceSchema, parseAnnotations } from './annotations.schema';

export const UNSUPPORTED_FILE_MESSAGE = 'Only PDF and image files can be referenced';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** PDFs and images are the only referenceable file types. */
export function isReferenceableMime(mime: string | null | undefined): boolean {
  const m = (mime ?? '').toLowerCase().trim();
  return m === 'application/pdf' || m.startsWith('image/');
}

/* eslint-disable @typescript-eslint/no-explicit-any */

@Injectable()
export class ReferencesService {
  constructor(private readonly prisma: PrismaService) {}

  async assertMember(projectId: string | undefined, userId: string | undefined): Promise<void> {
    if (!userId || !projectId) throw new ForbiddenException('not a project member');
    const member = await this.prisma.project_members.findUnique({
      where: { project_id_user_id: { project_id: projectId, user_id: userId } },
    });
    if (!member) throw new ForbiddenException('not a project member');
  }

  private async loadMessage(messageId: string, userId: string | undefined) {
    if (!UUID_RE.test(messageId)) throw new NotFoundException('message not found');
    const message: any = await this.prisma.messages.findFirst({
      where: { id: messageId, deleted_at: null },
      include: { channel: true },
    });
    if (!message) throw new NotFoundException('message not found');
    await this.assertMember(message.channel?.project_id, userId);
    return message;
  }

  private async loadReference(referenceId: string, userId: string | undefined) {
    if (!UUID_RE.test(referenceId)) throw new NotFoundException('reference not found');
    const ref: any = await this.prisma.references.findUnique({
      where: { id: referenceId },
      include: {
        message: { include: { channel: true } },
        file_version: { include: { file: true } },
      },
    });
    if (!ref) throw new NotFoundException('reference not found');
    await this.assertMember(ref.message?.channel?.project_id, userId);
    return ref;
  }

  private serialize(ref: any, userId: string | undefined) {
    const file = ref.file_version?.file ?? null;
    const fileAvailable = !!file && !file.deleted_at;
    const projectId = ref.message?.channel?.project_id ?? null;
    return {
      id: ref.id,
      message_id: ref.message_id,
      project_id: projectId,
      file_id: file?.id ?? null,
      file_name: fileAvailable ? file.name : null,
      mime_type: fileAvailable ? file.mime_type : null,
      file_version_id: ref.file_version_id,
      version_number: ref.file_version?.version_number ?? null,
      page_number: ref.page_number ?? 1,
      annotations: Array.isArray(ref.annotations) ? ref.annotations : [],
      author_id: ref.author_id,
      updated_at: ref.updated_at,
      can_edit: !!userId && ref.author_id === userId,
      file_available: fileAvailable,
      page_image_url: fileAvailable
        ? `/api/file-versions/${ref.file_version_id}/pages/${ref.page_number ?? 1}`
        : null,
    };
  }

  async create(messageId: string, userId: string | undefined, body: unknown) {
    const message = await this.loadMessage(messageId, userId);
    const parsedBody = createReferenceSchema.safeParse(body ?? {});
    if (!parsedBody.success) throw new BadRequestException('fileId and annotations are required');
    const { fileId, pageNumber } = parsedBody.data;
    const annotations = parseAnnotations(parsedBody.data.annotations);
    if (!annotations.ok) throw new BadRequestException(annotations.error);
    if (message.author_id !== userId) throw new ForbiddenException('only the message author can add a reference');

    if (!UUID_RE.test(fileId)) throw new BadRequestException('file not found');
    const file: any = await this.prisma.files.findFirst({ where: { id: fileId, deleted_at: null } });
    if (!file || file.project_id !== message.channel.project_id) {
      throw new BadRequestException('file not found in this project');
    }
    if (!isReferenceableMime(file.mime_type)) throw new BadRequestException(UNSUPPORTED_FILE_MESSAGE);
    if (!file.current_version_id) throw new BadRequestException('file has no stored version');
    const page = file.mime_type.toLowerCase().startsWith('image/') ? 1 : pageNumber ?? 1;

    const existing = await this.prisma.references.findUnique({ where: { message_id: messageId } });
    if (existing) throw new ConflictException('message already has a reference');

    const created = await this.prisma.references.create({
      data: {
        message_id: messageId,
        file_version_id: file.current_version_id,
        page_number: page,
        annotations: annotations.value as any,
        author_id: userId as string,
      },
    });
    return this.get(created.id, userId);
  }

  async get(referenceId: string, userId: string | undefined) {
    const ref = await this.loadReference(referenceId, userId);
    return this.serialize(ref, userId);
  }

  async update(referenceId: string, userId: string | undefined, body: any) {
    const ref = await this.loadReference(referenceId, userId);
    if (ref.author_id !== userId) throw new ForbiddenException('only the author can edit this reference');
    const annotations = parseAnnotations(body?.annotations);
    if (!annotations.ok) throw new BadRequestException(annotations.error);
    await this.prisma.references.update({
      where: { id: referenceId },
      data: { annotations: annotations.value as any, updated_at: new Date() },
    });
    return this.get(referenceId, userId);
  }

  async remove(referenceId: string, userId: string | undefined): Promise<void> {
    const ref = await this.loadReference(referenceId, userId);
    if (ref.author_id !== userId) throw new ForbiddenException('only the author can delete this reference');
    await this.prisma.references.delete({ where: { id: referenceId } });
  }
}
