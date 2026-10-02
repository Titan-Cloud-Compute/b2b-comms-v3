import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../../prisma/prisma.service';
import type { QuestionDto } from './active-questions.types';
import { resolveSide } from './question-side';

/* eslint-disable @typescript-eslint/no-explicit-any */

const createQuestionSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'title must not be blank')
    .max(200, 'title is too long'),
  body_html: z.string().refine(
    (s) => s.replace(/<[^>]*>/g, '').trim().length > 0,
    { message: 'message body must not be blank' },
  ),
});

@Injectable()
export class ActiveQuestionsService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Private helpers ────────────────────────────────────────────────────────

  private db(): any {
    return this.prisma as any;
  }

  /**
   * Resolve the 'internal' | 'external' side for a given user id.
   * Looks up the user's organization from the database.
   */
  private async getUserSide(userId: string): Promise<'internal' | 'external'> {
    const db = this.db();
    const user = await db.user.findUnique({
      where: { id: userId },
      include: { organization: true },
    });
    return resolveSide(user ?? {});
  }

  /**
   * Throws NotFoundException if the project does not exist.
   * Throws ForbiddenException if userId is not a project member.
   * No role exemption — membership is required for all users.
   */
  private async assertMember(projectId: string, userId: string): Promise<void> {
    const db = this.db();
    const project = await db.projects.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('project not found');
    const member = await db.project_members.findUnique({
      where: { project_id_user_id: { project_id: projectId, user_id: userId } },
    });
    if (!member) throw new ForbiddenException('not a project member');
  }

  /**
   * Loads a channel by id and asserts kind === 'question'.
   * Throws NotFoundException otherwise.
   */
  private async loadQuestion(channelId: string): Promise<any> {
    const db = this.db();
    const channel = await db.channels.findUnique({ where: { id: channelId } });
    if (!channel || channel.kind !== 'question') {
      throw new NotFoundException('question not found');
    }
    return channel;
  }

  /** Build a QuestionDto from a channel row + the calling userId. */
  private async buildDto(channel: any, userId: string): Promise<QuestionDto> {
    const db = this.db();
    const resolutions: any[] = await db.question_resolutions.findMany({
      where: { channel_id: channel.id },
    });
    const mySide = await this.getUserSide(userId);
    return {
      id: channel.id as string,
      projectId: channel.project_id as string,
      title: channel.name as string,
      status: channel.status as string,
      createdBy: channel.created_by as string,
      createdAt: channel.created_at as Date,
      resolvedSides: resolutions.map((r) => r.side as 'internal' | 'external'),
      mySide,
    };
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  async listQuestions(projectId: string, userId: string): Promise<QuestionDto[]> {
    await this.assertMember(projectId, userId);
    const db = this.db();
    const channels: any[] = await db.channels.findMany({
      where: { project_id: projectId, kind: 'question' },
      orderBy: { created_at: 'desc' },
    });
    return Promise.all(channels.map((c) => this.buildDto(c, userId)));
  }

  async createQuestion(
    projectId: string,
    userId: string,
    body: unknown,
  ): Promise<QuestionDto> {
    // Membership checked first (before validation), per the spec.
    await this.assertMember(projectId, userId);

    const parsed = createQuestionSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues.map((i) => i.message).join('; ') || 'invalid request',
      );
    }

    const { title, body_html } = parsed.data;
    const db = this.db();

    let createdChannel!: any;
    await db.$transaction(async (tx: any) => {
      createdChannel = await tx.channels.create({
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
          channel_id: createdChannel.id,
          author_id: userId,
          body_html,
        },
      });
    });

    return this.buildDto(createdChannel, userId);
  }

  /**
   * Mark the calling user's side as resolved.
   * If both sides are now resolved, sets channels.status = 'resolved'.
   * Idempotent: if already fully resolved, returns the DTO without changes.
   */
  async resolve(channelId: string, userId: string): Promise<QuestionDto> {
    const channel = await this.loadQuestion(channelId);
    await this.assertMember(channel.project_id as string, userId);

    // Already fully resolved — idempotent 200.
    if (channel.status === 'resolved') {
      return this.buildDto(channel, userId);
    }

    const side = await this.getUserSide(userId);
    const db = this.db();
    let updatedChannel: any = channel;

    await db.$transaction(async (tx: any) => {
      await tx.question_resolutions.upsert({
        where: { channel_id_side: { channel_id: channelId, side } },
        create: { channel_id: channelId, side, resolved_by: userId },
        update: { resolved_by: userId },
      });

      const resolutions: any[] = await tx.question_resolutions.findMany({
        where: { channel_id: channelId },
      });
      const sides = new Set<string>(resolutions.map((r) => r.side as string));

      if (sides.has('internal') && sides.has('external')) {
        updatedChannel = await tx.channels.update({
          where: { id: channelId },
          data: { status: 'resolved' },
        });
      }
    });

    return this.buildDto(updatedChannel, userId);
  }

  /**
   * Withdraw this user's resolution mark.
   * Throws ForbiddenException if the question is already fully resolved.
   */
  async withdraw(channelId: string, userId: string): Promise<QuestionDto> {
    const channel = await this.loadQuestion(channelId);
    await this.assertMember(channel.project_id as string, userId);

    if (channel.status === 'resolved') {
      throw new ForbiddenException('question is resolved');
    }

    const side = await this.getUserSide(userId);
    const db = this.db();

    await db.question_resolutions.deleteMany({
      where: { channel_id: channelId, side },
    });

    return this.buildDto(channel, userId);
  }
}
