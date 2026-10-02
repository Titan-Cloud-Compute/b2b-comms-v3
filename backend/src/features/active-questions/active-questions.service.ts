import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Actor, ProjectFacts, canViewProject } from '../projects/projects.policy';
import { isBlankMessageHtml, sanitizeMessageHtml } from '../general-channels/message-sanitizer';
import {
  CHANNEL_KIND_QUESTION,
  CreateQuestionInput,
  QUESTION_STATUS_OPEN,
  QUESTION_STATUS_RESOLVED,
  QuestionSide,
  bothSidesResolved,
  sideOf,
} from './active-questions.policy';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = any;

export interface QuestionDto {
  id: string;
  projectId: string;
  kind: string;
  name: string;
  status: string;
  resolvedSides: string[];
  mySide: QuestionSide;
  createdBy: string;
  createdAt: Date;
}

function projectFacts(p: Row): ProjectFacts {
  return {
    organizationId: p.organization_id,
    status: p.status,
    memberUserIds: (p.members ?? []).map((m: Row) => m.user_id),
  };
}

@Injectable()
export class ActiveQuestionsService {
  constructor(private readonly prisma: PrismaService) {}

  private get db(): any {
    return this.prisma as any;
  }

  private dto(actor: Actor, c: Row, sides: string[]): QuestionDto {
    return {
      id: c.id,
      projectId: c.project_id,
      kind: c.kind,
      name: c.name,
      status: c.status,
      resolvedSides: [...sides].sort(),
      mySide: sideOf(actor),
      createdBy: c.created_by,
      createdAt: c.created_at,
    };
  }

  private async sidesOf(channelId: string): Promise<string[]> {
    const rows = await this.db.question_resolutions.findMany({ where: { channel_id: channelId } });
    return rows.map((r: Row) => r.side);
  }

  private async loadProject(actor: Actor, projectId: string): Promise<Row> {
    const row = await this.db.projects.findUnique({
      where: { id: projectId },
      include: { members: { select: { user_id: true } } },
    });
    if (!row) throw new NotFoundException('project not found');
    if (!canViewProject(actor, projectFacts(row))) throw new ForbiddenException('you cannot access this project');
    return row;
  }

  /** Load a question channel the actor may access, or throw 404/403. */
  private async loadQuestion(actor: Actor, channelId: string): Promise<Row> {
    const channel = await this.db.channels.findUnique({
      where: { id: channelId },
      include: { project: { include: { members: { select: { user_id: true } } } } },
    });
    if (!channel || channel.kind !== CHANNEL_KIND_QUESTION) throw new NotFoundException('question not found');
    if (!canViewProject(actor, projectFacts(channel.project))) {
      throw new ForbiddenException('you cannot access this question');
    }
    return channel;
  }

  async list(actor: Actor, projectId: string): Promise<QuestionDto[]> {
    await this.loadProject(actor, projectId);
    const rows = await this.db.channels.findMany({
      where: { project_id: projectId, kind: CHANNEL_KIND_QUESTION },
      include: { resolutions: true },
      orderBy: { created_at: 'asc' },
    });
    return rows.map((c: Row) => this.dto(actor, c, (c.resolutions ?? []).map((r: Row) => r.side)));
  }

  async get(actor: Actor, channelId: string): Promise<QuestionDto> {
    const channel = await this.loadQuestion(actor, channelId);
    return this.dto(actor, channel, await this.sidesOf(channelId));
  }

  async create(actor: Actor, projectId: string, input: CreateQuestionInput): Promise<QuestionDto> {
    const project = await this.loadProject(actor, projectId);
    const bodyHtml = sanitizeMessageHtml(input.bodyHtml);
    if (isBlankMessageHtml(bodyHtml)) throw new BadRequestException('first message must not be blank');
    const fileIds = [...new Set(input.attachmentFileIds)];
    if (fileIds.length) {
      const files = await this.db.files.findMany({
        where: { id: { in: fileIds }, project_id: project.id, deleted_at: null },
        select: { id: true },
      });
      if (files.length !== fileIds.length) throw new BadRequestException('attachment not found in this project');
    }
    const channel = await this.db.channels.create({
      data: {
        project_id: projectId,
        kind: CHANNEL_KIND_QUESTION,
        name: input.title,
        internal_only: false,
        status: QUESTION_STATUS_OPEN,
        created_by: actor.userId,
      },
    });
    await this.db.messages.create({
      data: {
        channel_id: channel.id,
        author_id: actor.userId,
        body_html: bodyHtml,
        ...(fileIds.length ? { attachments: { create: fileIds.map((file_id) => ({ file_id })) } } : {}),
      },
    });
    return this.dto(actor, channel, []);
  }

  async resolve(actor: Actor, channelId: string): Promise<QuestionDto> {
    const channel = await this.loadQuestion(actor, channelId);
    if (channel.status === QUESTION_STATUS_RESOLVED) {
      return this.dto(actor, channel, await this.sidesOf(channelId));
    }
    const side = sideOf(actor);
    await this.db.question_resolutions.upsert({
      where: { channel_id_side: { channel_id: channelId, side } },
      create: { channel_id: channelId, side, resolved_by: actor.userId },
      update: { resolved_by: actor.userId, resolved_at: new Date() },
    });
    const sides = await this.sidesOf(channelId);
    let current = channel;
    if (bothSidesResolved(sides)) {
      current = await this.db.channels.update({
        where: { id: channelId },
        data: { status: QUESTION_STATUS_RESOLVED },
      });
    }
    return this.dto(actor, current, sides);
  }

  async withdraw(actor: Actor, channelId: string): Promise<QuestionDto> {
    const channel = await this.loadQuestion(actor, channelId);
    if (channel.status === QUESTION_STATUS_RESOLVED) {
      throw new ConflictException('question is already resolved by both parties');
    }
    await this.clearResolutions(channelId);
    return this.dto(actor, channel, []);
  }

  async clearResolutions(channelId: string): Promise<void> {
    await this.db.question_resolutions.deleteMany({ where: { channel_id: channelId } });
  }

  /** Raw channel lookup used by the message-post hook (no access check — the channel route does that). */
  async findChannel(channelId: string): Promise<Row | null> {
    return this.db.channels.findUnique({ where: { id: channelId } });
  }
}
