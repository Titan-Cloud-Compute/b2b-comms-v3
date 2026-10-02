import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { validateAnnotations, Annotations } from './annotations.schema';
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
  page_number?: number;
  annotations: unknown;
}

export interface ReferenceDto {
  id: string;
  message_id: string;
  file_version_id: string;
  file_id: string;
  file_name: string;
  mime_type: string;
  page_number: number;
  annotations: Annotations;
  author_id: string;
  updated_at: Date;
  can_edit: boolean;
  file_available: boolean;
  page_url: string;
}

function toDto(ref: Row, file: Row, userId: string): ReferenceDto {
  return {
    id: ref.id,
    message_id: ref.message_id,
    file_version_id: ref.file_version_id,
    file_id: file.id,
    file_name: file.name,
    mime_type: file.mime_type,
    page_number: ref.page_number,
    annotations: ref.annotations,
    author_id: ref.author_id,
    updated_at: ref.updated_at,
    can_edit: ref.author_id === userId,
    file_available: file.deleted_at === null,
    page_url: `/api/file-versions/${ref.file_version_id}/pages/${ref.page_number}`,
  };
}

@Injectable()
export class ReferencesService {
  constructor(private readonly prisma: PrismaService) {}

  private get db(): any {
    return this.prisma as any;
  }

  async create(userId: string, messageId: string, input: CreateReferenceInput): Promise<ReferenceDto> {
    // 1. Load message (with channel for project_id)
    const message = await this.db.messages.findUnique({
      where: { id: messageId },
      include: { channel: { select: { project_id: true, internal_only: true } } },
    });
    if (!message || message.deleted_at) {
      throw new NotFoundException('message not found');
    }

    // 2. Caller must be the message author
    if (message.author_id !== userId) {
      throw new ForbiddenException('only the message author can add a reference');
    }

    const projectId = message.channel.project_id;

    // 3. Membership check
    await assertProjectMember(this.db, userId, projectId);

    // 4. Resolve file version
    let fileVersionId = input.file_version_id;
    let file: Row;

    if (fileVersionId) {
      const version = await this.db.file_versions.findUnique({ where: { id: fileVersionId } });
      if (!version) throw new NotFoundException('file version not found');
      file = await this.db.files.findUnique({ where: { id: version.file_id } });
    } else if (input.file_id) {
      file = await this.db.files.findUnique({ where: { id: input.file_id } });
      if (!file) throw new NotFoundException('file not found');
      fileVersionId = file.current_version_id;
      if (!fileVersionId) throw new BadRequestException('file has no current version');
    } else {
      throw new BadRequestException('file_id or file_version_id is required');
    }

    if (!file) throw new NotFoundException('file not found');

    // 5. File must belong to the same project and not be deleted
    if (file.project_id !== projectId || file.deleted_at !== null) {
      throw new ForbiddenException('file is not available in this project');
    }

    // 6. Only PDF or image files
    if (file.mime_type !== 'application/pdf' && !file.mime_type.startsWith('image/')) {
      throw new BadRequestException('Only PDF and image files can be referenced');
    }

    // 7. Validate page_number
    const pageNumber = input.page_number;
    if (!Number.isInteger(pageNumber) || pageNumber < 1) {
      throw new BadRequestException('page_number must be an integer >= 1');
    }
    if (file.mime_type.startsWith('image/') && pageNumber !== 1) {
      throw new BadRequestException('page_number must be 1 for image files');
    }

    // 8. Validate annotations — before any write
    const annotations = validateAnnotations(input.annotations);

    // 9. No duplicate reference on the same message
    const existing = await this.db.references.findUnique({ where: { message_id: messageId } });
    if (existing) {
      throw new ConflictException('a reference already exists for this message');
    }

    // 10. Insert
    const now = new Date();
    const ref = await this.db.references.create({
      data: {
        message_id: messageId,
        file_version_id: fileVersionId as string,
        page_number: pageNumber,
        annotations,
        author_id: userId,
        updated_at: now,
      },
    });

    return toDto(ref, file, userId);
  }

  async view(userId: string, referenceId: string): Promise<ReferenceDto> {
    const ref = await this.db.references.findUnique({ where: { id: referenceId } });
    if (!ref) throw new NotFoundException('reference not found');

    // Load message → channel → project
    const message = await this.db.messages.findUnique({
      where: { id: ref.message_id },
      include: { channel: { select: { project_id: true } } },
    });
    if (!message) throw new NotFoundException('message not found');

    const projectId = message.channel.project_id;
    await assertProjectMember(this.db, userId, projectId);

    // Load file_version and file
    const version = await this.db.file_versions.findUnique({ where: { id: ref.file_version_id } });
    if (!version) throw new NotFoundException('file version not found');
    const file = await this.db.files.findUnique({ where: { id: version.file_id } });
    if (!file) throw new NotFoundException('file not found');

    return toDto(ref, file, userId);
  }

  async update(userId: string, referenceId: string, input: UpdateReferenceInput): Promise<ReferenceDto> {
    const ref = await this.db.references.findUnique({ where: { id: referenceId } });
    if (!ref) throw new NotFoundException('reference not found');

    const message = await this.db.messages.findUnique({
      where: { id: ref.message_id },
      include: { channel: { select: { project_id: true } } },
    });
    if (!message) throw new NotFoundException('message not found');

    const projectId = message.channel.project_id;
    await assertProjectMember(this.db, userId, projectId);

    if (ref.author_id !== userId) {
      throw new ForbiddenException('only the reference author can edit this reference');
    }

    // Validate before any write
    const annotations = validateAnnotations(input.annotations);

    const pageNumber = input.page_number ?? ref.page_number;
    if (!Number.isInteger(pageNumber) || pageNumber < 1) {
      throw new BadRequestException('page_number must be an integer >= 1');
    }

    const now = new Date();
    const updated = await this.db.references.update({
      where: { id: referenceId },
      data: { annotations, page_number: pageNumber, updated_at: now },
    });

    const version = await this.db.file_versions.findUnique({ where: { id: ref.file_version_id } });
    if (!version) throw new NotFoundException('file version not found');
    const file = await this.db.files.findUnique({ where: { id: version.file_id } });
    if (!file) throw new NotFoundException('file not found');

    return toDto(updated, file, userId);
  }

  async remove(userId: string, referenceId: string): Promise<void> {
    const ref = await this.db.references.findUnique({ where: { id: referenceId } });
    if (!ref) throw new NotFoundException('reference not found');

    const message = await this.db.messages.findUnique({
      where: { id: ref.message_id },
      include: { channel: { select: { project_id: true } } },
    });
    if (!message) throw new NotFoundException('message not found');

    const projectId = message.channel.project_id;
    await assertProjectMember(this.db, userId, projectId);

    if (ref.author_id !== userId) {
      throw new ForbiddenException('only the reference author can delete this reference');
    }

    await this.db.references.delete({ where: { id: referenceId } });
  }
}
