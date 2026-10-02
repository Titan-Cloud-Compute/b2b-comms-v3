import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../../prisma/prisma.service';
import { QuestionDto } from './active-questions.types';
import { resolveSide } from './question-side';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Strip all HTML tags and decode &nbsp; to detect semantically blank content. */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .trim();
}

const createQuestionSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'title must not be blank')
    .max(200, 'title too long'),
  body_html: z
    .string()
    .refine((v) => stripHtml(v).length > 0, { message: 'body_html must not be blank' }),
});

@Injectable()
export class ActiveQuestionsService {
  constructor(private readonly prisma: PrismaService) {}

  private get db(): any {
    return this.prisma as any;
  }

  /**
   * Throws NotFoundException if the project does not exist.
   * Throws ForbiddenException if userId is not a project member.
   */
  private async assertMember(projectId: string, userId: string): Promise<void> {
    const project = await this.db.projects.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('project not found');
    const member = await this.db.project_members.findUnique({
      where: { project_id_user_id: { project_id: projectId, user_id: userId } },
    });
    if (!member) throw new ForbiddenException('not a member of this project');
  }

  /** Loads the channel and asserts kind === 'question'; throws NotFoundException otherwise. */
  private async loadQuestion(channelId: string): Promise<any> {
    const channel = await this.db.channels.findUnique({ where: { id: channelId } });
    if (!channel || channel.kind !== 'question') throw new NotFoundException('question not found');
    return channel;
  }

  private async loadResolutions(channelId: string): Promise<any[]> {
    return this.db.question_resolutions.findMany({ where: { channel_id: channelId } });
  }

  /** Derives 'internal' | 'external' side for the given user by looking up their organization. */
  private async getUserSide(userId: string): Promise<'internal' | 'external'> {
    const user = await this.db.user.findUnique({
      where: { id: userId },
      select: { organization_id: true },
    });
    if (!user?.organization_id) return 'internal';
    const org = await this.db.organizations.findUnique({
      where: { id: user.organization_id },
      select: { is_internal: true },
    });
    return resolveSide(org?.is_internal);
  }

  private toDto(channel: any, resolutions: any[], mySide: 'internal' | 'external'): QuestionDto {
    return {
      id: channel.id,
      projectId: channel.project_id,
      title: channel.name,
      status: channel.status,
      createdBy: channel.created_by,
      createdAt: channel.created_at,
      resolvedSides: resolutions.map((r: any) => r.side as 'internal' | 'external'),
      mySide,
    };
  }

  async listQuestions(projectId: string, userId: string): Promise<QuestionDto[]> {
    await this.assertMember(projectId, userId);
    const mySide = await this.getUserSide(userId);
    const channels = await this.db.channels.findMany({
      where: { project_id: projectId, kind: 'question' },
      orderBy: { created_at: 'desc' },
    });
    const result: QuestionDto[] = [];
    for (const ch of channels) {
      const resolutions = await this.loadResolutions(ch.id);
      result.push(this.toDto(ch, resolutions, mySide));
    }
    return result;
  }

  async createQuestion(projectId: string, userId: string, body: unknown): Promise<QuestionDto> {
    // Membership is checked FIRST, then validation.
    await this.assertMember(projectId, userId);

    const parsed = createQuestionSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues);
    }
    const title = parsed.data.title; // already trimmed by zod
    const bodyHtml = parsed.data.body_html;

    const mySide = await this.getUserSide(userId);

    const { channel } = await this.db.$transaction(async (tx: any) => {
      const channel = await tx.channels.create({
        data: {
          project_id: projectId,
          kind: 'question',
          name: title,
          internal_only: false,
          status: 'open',
          created_by: userId,
        },
      });
      await tx.messages.create({
        data: {
          channel_id: channel.id,
          author_id: userId,
          body_html: bodyHtml,
        },
      });
      return { channel };
    });

    return this.toDto(channel, [], mySide);
  }

  async resolve(channelId: string, userId: string): Promise<QuestionDto> {
    const channel = await this.loadQuestion(channelId);
    await this.assertMember(channel.project_id, userId);

    // If already resolved, return idempotent 200
    if (channel.status === 'resolved') {
      const resolutions = await this.loadResolutions(channelId);
      const mySide = await this.getUserSide(userId);
      return this.toDto(channel, resolutions, mySide);
    }

    const mySide = await this.getUserSide(userId);

    await this.db.question_resolutions.upsert({
      where: { channel_id_side: { channel_id: channelId, side: mySide } },
      create: { channel_id: channelId, side: mySide, resolved_by: userId },
      update: { resolved_by: userId },
    });

    const resolutions = await this.loadResolutions(channelId);
    const sides = resolutions.map((r: any) => r.side);
    let updatedChannel = channel;

    if (sides.includes('internal') && sides.includes('external')) {
      updatedChannel = await this.db.channels.update({
        where: { id: channelId },
        data: { status: 'resolved' },
      });
    }

    return this.toDto(updatedChannel, resolutions, mySide);
  }

  async withdraw(channelId: string, userId: string): Promise<QuestionDto> {
    const channel = await this.loadQuestion(channelId);
    await this.assertMember(channel.project_id, userId);

    if (channel.status === 'resolved') {
      throw new ForbiddenException('question is resolved');
    }

    const mySide = await this.getUserSide(userId);

    await this.db.question_resolutions.deleteMany({
      where: { channel_id: channelId, side: mySide },
    });

    const resolutions = await this.loadResolutions(channelId);
    return this.toDto(channel, resolutions, mySide);
  }
}
