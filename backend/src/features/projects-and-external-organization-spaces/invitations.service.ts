import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
// Value imports (NOT `import type`) so Nest can inject them.
import { PrismaService } from '../../prisma/prisma.service';
import { InvitationMailerService } from './invitation-mailer.service';
import { Actor, ProjectsService, canManage } from './projects.service';

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type Delivery = 'sent' | 'failed';

export interface InvitationDto {
  id: string;
  project_id: string;
  email: string;
  status: string;
  delivery: Delivery;
  expires_at: string;
}

/** Same hashing as POST /api/invitations/accept (sha256 hex of the raw token). */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class InvitationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
    private readonly mailer: InvitationMailerService,
  ) {}

  async invite(actor: Actor, projectId: string, rawEmail: string): Promise<InvitationDto> {
    if (!canManage(actor)) throw new ForbiddenException('Only managers and admins can invite contacts');
    const email = (rawEmail ?? '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BadRequestException('email: must be a valid email');
    const token = randomBytes(32).toString('hex');
    const { row, projectName } = await this.prisma.runAsAdmin(async (tx) => {
      const project = await this.projects.loadAccessible(tx, actor, projectId);
      if (project.status === 'archived') throw new ForbiddenException('Project is archived');
      const created = await tx.invitations.create({
        data: {
          project_id: projectId,
          email,
          token_hash: hashToken(token),
          status: 'pending',
          invited_by: actor.userId,
          expires_at: new Date(Date.now() + INVITATION_TTL_MS),
        },
      });
      return { row: created, projectName: project.name ?? '' };
    });
    const delivery = await this.deliver(email, token, projectName);
    return this.toDto(row, delivery);
  }

  async resend(actor: Actor, invitationId: string) {
    if (!canManage(actor)) throw new ForbiddenException('Only managers and admins can resend invitations');
    const token = randomBytes(32).toString('hex');
    const { row, projectName } = await this.prisma.runAsAdmin(async (tx) => {
      const inv = await tx.invitations.findUnique({ where: { id: invitationId } });
      if (!inv || !inv.project_id) throw new NotFoundException('Invitation does not exist');
      const project = await this.projects.loadAccessible(tx, actor, inv.project_id);
      if (inv.status === 'accepted') throw new BadRequestException('Invitation already accepted');
      const updated = await tx.invitations.update({
        where: { id: invitationId },
        data: {
          token_hash: hashToken(token),
          status: 'pending',
          expires_at: new Date(Date.now() + INVITATION_TTL_MS),
        },
      });
      return { row: updated, projectName: project.name ?? '' };
    });
    const delivery = await this.deliver(row.email ?? '', token, projectName);
    const dto = this.toDto(row, delivery);
    return { id: dto.id, status: dto.status, delivery: dto.delivery, expires_at: dto.expires_at };
  }

  private async deliver(email: string, token: string, projectName: string): Promise<Delivery> {
    try {
      await this.mailer.sendInvitation(email, token, projectName);
      return 'sent';
    } catch {
      return 'failed';
    }
  }

  private toDto(
    row: { id: string; project_id: string | null; email: string | null; status: string | null; expires_at: Date | null },
    delivery: Delivery,
  ): InvitationDto {
    return {
      id: row.id,
      project_id: row.project_id ?? '',
      email: row.email ?? '',
      status: row.status ?? 'pending',
      delivery,
      expires_at: (row.expires_at ?? new Date()).toISOString(),
    };
  }
}
