import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { createHash } from 'crypto';
import type { User } from '@prisma/client';
// Value import (NOT `import type`) so Nest can inject it.
import { PrismaService } from '../../prisma/prisma.service';

export const USER_ROLES = ['ADMIN', 'MANAGER', 'USER'] as const;
export type AdminUserRole = (typeof USER_ROLES)[number];

export interface UserListItem {
  id: string;
  email: string;
  display_name: string | null;
  role: string;
  organization_id: string | null;
  active: boolean;
  created_at: string;
}

export interface CreateUserInput {
  email: string;
  password: string;
  display_name?: string;
  role: AdminUserRole;
  organization_id?: string | null;
}

export interface UpdateUserInput {
  email?: string;
  display_name?: string;
  role?: AdminUserRole;
  active?: boolean;
  organization_id?: string | null;
}

export interface AcceptInvitationInput {
  token: string;
  display_name: string;
  password: string;
}

export function toUserListItem(u: User): UserListItem {
  return {
    id: u.id,
    email: u.email,
    display_name: u.displayName ?? u.name ?? null,
    role: u.role,
    organization_id: u.organizationId ?? null,
    active: u.active !== false,
    created_at: (u.created_at ?? u.createdAt).toISOString(),
  };
}

export function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class AuthenticationAndRolesService {
  constructor(private readonly prisma: PrismaService) {}

  async listUsers(page: number, pageSize: number) {
    const skip = (page - 1) * pageSize;
    const [rows, total] = await this.prisma.runAsAdmin((tx) =>
      Promise.all([
        tx.user.findMany({ orderBy: { createdAt: 'asc' }, skip, take: pageSize }),
        tx.user.count(),
      ]),
    );
    return { items: rows.map(toUserListItem), page, total };
  }

  async createUser(input: CreateUserInput): Promise<UserListItem> {
    const email = input.email.trim().toLowerCase();
    const passwordHash = await bcrypt.hash(input.password, 10);
    const user = await this.prisma.runAsAdmin(async (tx) => {
      const existing = await tx.user.findUnique({ where: { email } });
      if (existing) throw new ConflictException('email already in use');
      return tx.user.create({
        data: {
          email,
          passwordHash,
          name: input.display_name ?? null,
          displayName: input.display_name ?? null,
          role: input.role,
          organizationId: input.organization_id ?? null,
          active: true,
          created_at: new Date(),
        },
      });
    });
    return toUserListItem(user);
  }

  async updateUser(id: string, input: UpdateUserInput) {
    const user = await this.prisma.runAsAdmin(async (tx) => {
      const existing = await tx.user.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException('user not found');
      return tx.user.update({
        where: { id },
        data: {
          ...(input.email !== undefined ? { email: input.email.trim().toLowerCase() } : {}),
          ...(input.display_name !== undefined
            ? { displayName: input.display_name, name: input.display_name }
            : {}),
          ...(input.role !== undefined ? { role: input.role } : {}),
          ...(input.active !== undefined ? { active: input.active } : {}),
          ...(input.organization_id !== undefined ? { organizationId: input.organization_id } : {}),
        },
      });
    });
    // Sessions are stateless JWTs; JwtAuthGuard re-reads the user on every
    // request, so deactivation revokes (401 + cookie cleared) and role changes
    // apply on the user's next request.
    const item = toUserListItem(user);
    return {
      id: item.id,
      email: item.email,
      display_name: item.display_name,
      role: item.role,
      active: item.active,
    };
  }

  /**
   * Accept an invitation: 400 (and no users row) when the token is unknown,
   * expired, or already accepted.
   */
  async acceptInvitation(input: AcceptInvitationInput) {
    const tokenHash = hashInvitationToken(input.token);
    const passwordHash = await bcrypt.hash(input.password, 10);
    const user = await this.prisma.runAsAdmin(async (tx) => {
      const invitation = await tx.invitations.findFirst({ where: { token_hash: tokenHash } });
      if (!invitation || !invitation.email) {
        throw new BadRequestException('Invitation is invalid');
      }
      if (invitation.status && invitation.status !== 'pending') {
        throw new BadRequestException('Invitation has already been accepted');
      }
      if (!invitation.expires_at || invitation.expires_at.getTime() < Date.now()) {
        throw new BadRequestException('Invitation has expired');
      }
      const email = invitation.email.trim().toLowerCase();
      const existing = await tx.user.findUnique({ where: { email } });
      if (existing) throw new BadRequestException('An account already exists for this email');
      const project = invitation.project_id
        ? await tx.projects.findUnique({ where: { id: invitation.project_id } })
        : null;
      const created = await tx.user.create({
        data: {
          email,
          passwordHash,
          name: input.display_name,
          displayName: input.display_name,
          role: 'USER',
          organizationId: project?.organization_id ?? null,
          active: true,
          created_at: new Date(),
        },
      });
      await tx.invitations.update({ where: { id: invitation.id }, data: { status: 'accepted' } });
      if (invitation.project_id) {
        await tx.project_members.create({
          data: { project_id: invitation.project_id, user_id: created.id, added_at: new Date() },
        });
      }
      return created;
    });
    return toUserListItem(user);
  }
}
