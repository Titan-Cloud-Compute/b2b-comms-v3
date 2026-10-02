import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
// Value import (NOT `import type`) so Nest can inject it.
import { PrismaService } from '../../prisma/prisma.service';
import { type GcActor, canCreateChannel, sanitizeHtml } from '../general-channels/general-channels.logic';
import {
  QUESTION_KIND,
  QUESTION_OPEN,
  QUESTION_RESOLVED,
  isBlankText,
  isClosedQuestion,
  resolvedSides,
  sideOf,
  statusFor,
} from './active-question-chats.policy';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Tx = any;

export interface CreateQuestionInput { title?: unknown; name?: unknown; body_html?: unknown; message?: unknown }

@Injectable()
export class ActiveQuestionChatsService {
  constructor(private readonly prisma: PrismaService) {}

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
  private async assertProjectAccess(tx: Tx, actor: GcActor, projectId: string) {
    const project = await tx.projects.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Project does not exist');
    if (actor.isExternal && project.organization_id !== actor.organizationId) throw new ForbiddenException('Forbidden');
    if (!canCreateChannel(actor)) {
      const member = await tx.project_members.findFirst({ where: { project_id: projectId, user_id: actor.userId } });
      if (!member) throw new ForbiddenException('Forbidden');
    }
    return project;
  }

  private async loadQuestion(tx: Tx, actor: GcActor, channelId: string) {
    const channel = await tx.channels.findUnique({ where: { id: channelId } });
    if (!channel || channel.kind !== QUESTION_KIND || !channel.project_id) throw new NotFoundException('Question does not exist');
    await this.assertProjectAccess(tx, actor, channel.project_id);
    return channel;
  }

  private async sidesOf(tx: Tx, channelId: string) {
    return resolvedSides(await tx.question_resolutions.findMany({ where: { channel_id: channelId } }));
  }

  async list(actor: GcActor, projectId: string) {
    return this.run(async (tx) => {
      await this.assertProjectAccess(tx, actor, projectId);
      const rows = ((await tx.channels.findMany({ where: { project_id: projectId, kind: QUESTION_KIND } })) as any[])
        .sort((a, b) => time(a.created_at ?? a.createdAt) - time(b.created_at ?? b.createdAt));
      const ids = rows.map((r) => r.id);
      const marks = ids.length ? ((await tx.question_resolutions.findMany({ where: { channel_id: { in: ids } } })) as any[]) : [];
      const states = ids.length
        ? ((await tx.channel_read_state.findMany({ where: { user_id: actor.userId, channel_id: { in: ids } } })) as any[])
        : [];
      return {
        items: rows.map((r) => ({
          id: r.id,
          name: r.name ?? '',
          status: r.status ?? QUESTION_OPEN,
          resolved_sides: resolvedSides(marks.filter((m) => m.channel_id === r.id)).join(','),
          unread_count: Number(states.find((s) => s.channel_id === r.id)?.unread_count ?? 0),
        })),
      };
    });
  }

  async create(actor: GcActor, projectId: string, input: CreateQuestionInput) {
    const title = input.title ?? input.name;
    const body = input.body_html ?? input.message;
    if (isBlankText(title)) throw new BadRequestException('title: must not be blank');
    if (isBlankText(body)) throw new BadRequestException('body_html: first message must not be blank');
    const name = String(title).trim().slice(0, 200);
    const body_html = sanitizeHtml(body);
    return this.run(async (tx) => {
      await this.assertProjectAccess(tx, actor, projectId);
      const now = new Date();
      const channel = await tx.channels.create({
        data: {
          project_id: projectId,
          kind: QUESTION_KIND,
          name,
          internal_only: false,
          status: QUESTION_OPEN,
          created_by: actor.userId,
          created_at: now,
        },
      });
      const message = await tx.messages.create({
        data: { channel_id: channel.id, author_id: actor.userId, body_html, created_at: now },
      });
      return { id: channel.id, name: channel.name, kind: channel.kind, status: channel.status, first_message_id: message.id };
    });
  }

  async resolve(actor: GcActor, channelId: string) {
    return this.run(async (tx) => {
      const channel = await this.loadQuestion(tx, actor, channelId);
      if (channel.status === QUESTION_RESOLVED) {
        return { id: channel.id, status: QUESTION_RESOLVED, resolved_sides: (await this.sidesOf(tx, channelId)).join(',') };
      }
      const side = sideOf(actor);
      const existing = await tx.question_resolutions.findFirst({ where: { channel_id: channelId, side } });
      if (existing) {
        await tx.question_resolutions.update({ where: { id: existing.id }, data: { resolved_by: actor.userId, resolved_at: new Date() } });
      } else {
        await tx.question_resolutions.create({
          data: { channel_id: channelId, side, resolved_by: actor.userId, resolved_at: new Date() },
        });
      }
      const sides = await this.sidesOf(tx, channelId);
      const status = statusFor(sides);
      if (status !== channel.status) await tx.channels.update({ where: { id: channelId }, data: { status } });
      return { id: channel.id, status, resolved_sides: sides.join(',') };
    });
  }

  async withdraw(actor: GcActor, channelId: string) {
    return this.run(async (tx) => {
      const channel = await this.loadQuestion(tx, actor, channelId);
      if (channel.status === QUESTION_RESOLVED) throw new ForbiddenException('Question is already resolved');
      await tx.question_resolutions.deleteMany({ where: { channel_id: channelId } });
      return { id: channel.id, status: QUESTION_OPEN, resolved_sides: '' };
    });
  }

  /** Hook for POST /api/channels/:id/messages — 403 when the question is resolved. */
  async assertCanPost(channelId: string): Promise<boolean> {
    return this.run(async (tx) => {
      const channel = await tx.channels.findUnique({ where: { id: channelId } });
      if (isClosedQuestion(channel)) throw new ForbiddenException('Question is resolved; no further messages');
      return !!channel && channel.kind === QUESTION_KIND;
    });
  }

  /** A new message re-opens the discussion: clear every resolution mark. */
  async clearResolutions(channelId: string): Promise<void> {
    await this.run(async (tx) => {
      await tx.question_resolutions.deleteMany({ where: { channel_id: channelId } });
    });
  }
}

function time(d: unknown): number {
  const t = d ? new Date(d as string).getTime() : 0;
  return Number.isNaN(t) ? 0 : t;
}
