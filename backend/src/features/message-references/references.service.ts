import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { validateAnnotations, Annotation } from './annotations.schema';
import { assertProjectMember } from './references.access';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = any;

export interface CreateReferenceInput {
  file_id?: string;
  file_version_id?: string;
  page_number: number;
  annotations: unknown;
}

export interface UpdateReferenceInput {
  annotations: unknown;
  page_number?: number;
}

export interface ReferenceView {
  id: string;
  message_id: string;
  file_version_id: string;
  file_id: string;
  file_name: string;
  mime_type: string;
  page_number: number;
  annotations: Annotation[];
  author_id: string;
  updated_at: Date;
  can_edit: boolean;
  file_available: boolean;
  page_url: string;
}

@Injectable()
export class ReferencesService {
  constructor(private readonly prisma: PrismaService) {}

  private db(): any {
    return this.prisma as any;
  }

  private buildView(ref: Row, userId: string): ReferenceView {
    const fv = ref.file_version;
    const file = fv?.file ?? null;
    const fileAvailable = !!(file && file.deleted_at === null && fv);
    return {
      id: ref.id,
      message_id: ref.message_id,
      file_version_id: ref.file_version_id,
      file_id: file?.id ?? null,
      file_name: file?.name ?? null,
      mime_type: file?.mime_type ?? null,
      page_number: ref.page_number,
      annotations: ref.annotations,
      author_id: ref.author_id,
      updated_at: ref.updated_at,
      can_edit: ref.author_id === userId,
      file_available: fileAvailable,
      page_url: `/api/file-versions/${ref.file_version_id}/pages/${ref.page_number}`,
    };
  }

  async create(userId: string, messageId: string, input: CreateReferenceInput): Promise<ReferenceView> {
    // Validate annotations first (400 before any DB writes)
    const annotations = validateAnnotations(input.annotations);

    // Validate page_number is integer >= 1
    const pageNumber = input.page_number;
    if (!Number.isInteger(pageNumber) || pageNumber < 1) {
      throw new BadRequestException('page_number must be an integer >= 1');
    }

    // Load message
    const message: Row = await this.db().messages.findUnique({
      where: { id: messageId },
      include: { channel: true },
    });
    if (!message || message.deleted_at !== null) {
      throw new NotFoundException('message not found');
    }

    // Caller must be the message author
    if (message.author_id !== userId) {
      throw new ForbiddenException('only the message author can add a reference');
    }

    const projectId: string = message.channel.project_id;

    // Assert membership
    const userRow: Row = await this.db().users.findUnique({ where: { id: userId } });
    await assertProjectMember(this.prisma, userId, projectId, {
      channelInternalOnly: message.channel.internal_only,
      userOrgIsInternal: userRow?.organization?.is_internal ?? userRow?.is_internal ?? false,
    });

    // Resolve file version
    let fileVersionId: string | undefined = input.file_version_id;
    if (!fileVersionId && input.file_id) {
      const file: Row = await this.db().files.findUnique({ where: { id: input.file_id } });
      if (!file || file.deleted_at !== null) {
        throw new NotFoundException('file not found');
      }
      fileVersionId = file.current_version_id;
    }
    if (!fileVersionId) {
      throw new BadRequestException('file_id or file_version_id is required');
    }

    // Load file version and file
    const fv: Row = await this.db().file_versions.findUnique({
      where: { id: fileVersionId },
      include: { file: true },
    });
    if (!fv) {
      throw new NotFoundException('file version not found');
    }
    const file: Row = fv.file;
    if (!file || file.deleted_at !== null) {
      throw new BadRequestException('file has been deleted');
    }

    // File must belong to the same project
    if (file.project_id !== projectId) {
      throw new ForbiddenException('file does not belong to this project');
    }

    // MIME type: only PDF or image
    const mime: string = file.mime_type ?? '';
    if (mime !== 'application/pdf' && !mime.startsWith('image/')) {
      throw new BadRequestException('Only PDF and image files can be referenced');
    }

    // For images, page_number must be 1
    if (mime.startsWith('image/') && pageNumber !== 1) {
      throw new BadRequestException('page_number must be 1 for image files');
    }

    // Refuse a second reference on the same message
    const existing: Row = await this.db().references.findUnique({ where: { message_id: messageId } });
    if (existing) {
      throw new ConflictException('this message already has a reference');
    }

    // Insert reference
    const now = new Date();
    const ref: Row = await this.db().references.create({
      data: {
        message_id: messageId,
        file_version_id: fileVersionId,
        page_number: pageNumber,
        annotations: annotations,
        author_id: userId,
        updated_at: now,
      },
    });

    // Re-fetch with relations for response
    const fullRef: Row = await this.db().references.findUnique({
      where: { id: ref.id },
      include: { file_version: { include: { file: true } } },
    });

    return this.buildView(fullRef, userId);
  }

  async view(userId: string, referenceId: string): Promise<ReferenceView> {
    const ref: Row = await this.db().references.findUnique({
      where: { id: referenceId },
      include: {
        message: { include: { channel: true } },
        file_version: { include: { file: true } },
      },
    });
    if (!ref) {
      throw new NotFoundException('reference not found');
    }

    const projectId: string = ref.message.channel.project_id;
    const userRow: Row = await this.db().users.findUnique({ where: { id: userId } });
    await assertProjectMember(this.prisma, userId, projectId, {
      channelInternalOnly: ref.message.channel.internal_only,
      userOrgIsInternal: userRow?.organization?.is_internal ?? false,
    });

    return this.buildView(ref, userId);
  }

  async update(userId: string, referenceId: string, input: UpdateReferenceInput): Promise<ReferenceView> {
    // Validate annotations before any DB write
    const annotations = validateAnnotations(input.annotations);

    // Validate page_number if provided
    if (input.page_number !== undefined) {
      if (!Number.isInteger(input.page_number) || input.page_number < 1) {
        throw new BadRequestException('page_number must be an integer >= 1');
      }
    }

    const ref: Row = await this.db().references.findUnique({
      where: { id: referenceId },
      include: {
        message: { include: { channel: true } },
        file_version: { include: { file: true } },
      },
    });
    if (!ref) {
      throw new NotFoundException('reference not found');
    }

    const projectId: string = ref.message.channel.project_id;
    const userRow: Row = await this.db().users.findUnique({ where: { id: userId } });
    await assertProjectMember(this.prisma, userId, projectId, {
      channelInternalOnly: ref.message.channel.internal_only,
      userOrgIsInternal: userRow?.organization?.is_internal ?? false,
    });

    // Only the author can edit
    if (ref.author_id !== userId) {
      throw new ForbiddenException('only the reference author can edit');
    }

    const now = new Date();
    const updateData: any = { annotations, updated_at: now };
    if (input.page_number !== undefined) {
      updateData.page_number = input.page_number;
    }

    await this.db().references.update({
      where: { id: referenceId },
      data: updateData,
    });

    const updatedRef: Row = await this.db().references.findUnique({
      where: { id: referenceId },
      include: { file_version: { include: { file: true } } },
    });

    return this.buildView(updatedRef, userId);
  }

  async remove(userId: string, referenceId: string): Promise<void> {
    const ref: Row = await this.db().references.findUnique({
      where: { id: referenceId },
      include: {
        message: { include: { channel: true } },
      },
    });
    if (!ref) {
      throw new NotFoundException('reference not found');
    }

    const projectId: string = ref.message.channel.project_id;
    const userRow: Row = await this.db().users.findUnique({ where: { id: userId } });
    await assertProjectMember(this.prisma, userId, projectId, {
      channelInternalOnly: ref.message.channel.internal_only,
      userOrgIsInternal: userRow?.organization?.is_internal ?? false,
    });

    // Only the author can delete
    if (ref.author_id !== userId) {
      throw new ForbiddenException('only the reference author can delete');
    }

    await this.db().references.delete({ where: { id: referenceId } });
  }
}
