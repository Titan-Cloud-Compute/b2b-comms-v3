import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  UnauthorizedException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
// Value import (NOT `import type`) so Nest can inject it.
import { PrismaService } from '../../prisma/prisma.service';

/** Stable id of the demo workspace guaranteed at boot. */
export const DEMO_PROJECT_ID = 'p1';

export const ORGANIZATION_TYPES = ['vendor', 'customer', 'client', 'other'] as const;
export type OrganizationType = (typeof ORGANIZATION_TYPES)[number];

type Tx = Prisma.TransactionClient;

/** Resolved caller: role plus organization scoping. */
export interface Actor {
  userId: string;
  role: string; // ADMIN | MANAGER | USER
  organizationId: string | null;
  /** True when the caller belongs to a non-internal (external) organization. */
  isExternal: boolean;
}

export interface OrganizationDto {
  id: string;
  name: string;
  type: string;
}

export interface ProjectListItem {
  id: string;
  name: string;
  status: string;
  organization: OrganizationDto;
}

export interface ProjectDetail extends ProjectListItem {
  default_channel_id: string | null;
  members: { id: string; display_name: string; role: string }[];
}

export interface CreateProjectInput {
  organization_name: string;
  organization_type: OrganizationType;
  name?: string;
}

export interface UpdateProjectInput {
  name?: string;
}

export function canManage(actor: Actor): boolean {
  return !actor.isExternal && (actor.role === 'ADMIN' || actor.role === 'MANAGER');
}

@Injectable()
export class ProjectsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ProjectsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Idempotently ensure the demo workspace (project "p1" for organization
   * "Globex", with its General channel) exists so /projects/p1 resolves on a
   * freshly seeded environment. Internal users without an organization are
   * added as members so employees see it in their assigned list. Never throws:
   * a failure here must not block app startup.
   */
  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.ensureDemoProject();
    } catch (err) {
      this.logger.warn(`demo project fixture skipped: ${(err as Error).message}`);
    }
  }

  async ensureDemoProject(): Promise<void> {
    const projectId = DEMO_PROJECT_ID;
    const orgId = 'org-globex';
    await this.prisma.runAsAdmin(async (tx) => {
      const now = new Date();
      const org = await tx.organizations.findUnique({ where: { id: orgId } });
      if (!org) {
        await tx.organizations.create({
          data: { id: orgId, name: 'Globex', type: 'customer', is_internal: false, created_at: now },
        });
      }
      const project = await tx.projects.findUnique({ where: { id: projectId } });
      if (!project) {
        await tx.projects.create({
          data: { id: projectId, organization_id: orgId, name: 'Globex', status: 'active', created_at: now },
        });
      }
      const channel = await tx.channels.findFirst({ where: { project_id: projectId, kind: 'general' } });
      if (!channel) {
        await tx.channels.create({
          data: {
            project_id: projectId,
            kind: 'general',
            name: 'General',
            internal_only: false,
            status: 'active',
            created_at: now,
          },
        });
      }
      const internalUsers = await tx.user.findMany({ where: { organizationId: null } });
      for (const u of internalUsers) {
        const member = await tx.project_members.findFirst({ where: { project_id: projectId, user_id: u.id } });
        if (!member) {
          await tx.project_members.create({ data: { project_id: projectId, user_id: u.id, added_at: now } });
        }
      }
    });
  }

  /** Load the caller's organization so external users can be isolated. */
  async resolveActor(session: { userId: string; role: string } | undefined): Promise<Actor> {
    if (!session) throw new UnauthorizedException('not authenticated');
    return this.prisma.runAsAdmin(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: session.userId } });
      const organizationId = user?.organizationId ?? null;
      let isExternal = false;
      if (organizationId) {
        const org = await tx.organizations.findUnique({ where: { id: organizationId } });
        isExternal = !!org && org.is_internal === false;
      }
      return { userId: session.userId, role: String(session.role), organizationId, isExternal };
    });
  }

  async list(actor: Actor, page: number, pageSize: number, includeArchived = false) {
    return this.prisma.runAsAdmin(async (tx) => {
      const where: Prisma.projectsWhereInput = {};
      if (!includeArchived) where.status = { not: 'archived' };
      // Employees and external users only see the projects they are members of.
      if (!canManage(actor)) {
        const memberships = await tx.project_members.findMany({ where: { user_id: actor.userId } });
        where.id = { in: memberships.map((m: { project_id: string | null }) => m.project_id).filter((x: string | null): x is string => !!x) };
      }
      if (actor.isExternal) where.organization_id = actor.organizationId ?? '__none__';
      const [rows, total] = await Promise.all([
        tx.projects.findMany({
          where,
          orderBy: { createdAt: 'asc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        tx.projects.count({ where }),
      ]);
      const items: ProjectListItem[] = [];
      for (const row of rows) items.push(await this.toListItem(tx, row));
      return { items, page, total };
    });
  }

  async create(actor: Actor, input: CreateProjectInput): Promise<ProjectDetail> {
    if (!canManage(actor)) throw new ForbiddenException('Only managers and admins can create projects');
    const orgName = (input.organization_name ?? '').trim();
    if (!orgName) throw new BadRequestException('organization_name: must not be blank');
    if (!ORGANIZATION_TYPES.includes(input.organization_type)) {
      throw new BadRequestException(`organization_type: must be one of ${ORGANIZATION_TYPES.join(', ')}`);
    }
    const projectName = (input.name ?? '').trim() || orgName;
    return this.prisma.runAsAdmin(async (tx) => {
      const now = new Date();
      const org = await tx.organizations.create({
        data: { name: orgName, type: input.organization_type, is_internal: false, created_at: now },
      });
      const project = await tx.projects.create({
        data: {
          organization_id: org.id,
          name: projectName,
          status: 'active',
          created_by: actor.userId,
          created_at: now,
        },
      });
      await tx.project_members.create({
        data: { project_id: project.id, user_id: actor.userId, added_at: now },
      });
      await tx.channels.create({
        data: {
          project_id: project.id,
          kind: 'general',
          name: 'General',
          internal_only: false,
          status: 'active',
          created_by: actor.userId,
          created_at: now,
        },
      });
      return this.toDetail(tx, project);
    });
  }

  /** Throws 404 when missing, 403 when the caller may not see it. */
  async get(actor: Actor, id: string): Promise<ProjectDetail> {
    return this.prisma.runAsAdmin(async (tx) => {
      const project = await this.loadAccessible(tx, actor, id);
      return this.toDetail(tx, project);
    });
  }

  async update(actor: Actor, id: string, input: UpdateProjectInput) {
    if (!canManage(actor)) throw new ForbiddenException('Only managers and admins can edit projects');
    const name = input.name?.trim();
    if (input.name !== undefined && !name) throw new BadRequestException('name: must not be blank');
    return this.prisma.runAsAdmin(async (tx) => {
      const project = await this.loadAccessible(tx, actor, id);
      if (project.status === 'archived') throw new ForbiddenException('Project is archived');
      const row = await tx.projects.update({ where: { id }, data: name ? { name } : {} });
      return { id: row.id, name: row.name ?? '', status: row.status ?? 'active' };
    });
  }

  async archive(actor: Actor, id: string) {
    if (actor.role !== 'ADMIN' || actor.isExternal) {
      throw new ForbiddenException('Only admins can archive projects');
    }
    return this.prisma.runAsAdmin(async (tx) => {
      await this.loadAccessible(tx, actor, id);
      const row = await tx.projects.update({ where: { id }, data: { status: 'archived' } });
      return { id: row.id, status: row.status ?? 'archived' };
    });
  }

  async addMember(actor: Actor, id: string, userId: string) {
    if (!canManage(actor)) throw new ForbiddenException('Only managers and admins can add members');
    return this.prisma.runAsAdmin(async (tx) => {
      const project = await this.loadAccessible(tx, actor, id);
      if (project.status === 'archived') throw new ForbiddenException('Project is archived');
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw new BadRequestException('user_id: unknown user');
      const existing = await tx.project_members.findFirst({ where: { project_id: id, user_id: userId } });
      const row =
        existing ??
        (await tx.project_members.create({ data: { project_id: id, user_id: userId, added_at: new Date() } }));
      return {
        project_id: id,
        user_id: userId,
        added_at: (row.added_at ?? row.createdAt).toISOString(),
      };
    });
  }

  /** Shared access policy (also used by invitations). */
  async loadAccessible(tx: Tx, actor: Actor, id: string) {
    const project = await tx.projects.findUnique({ where: { id } });
    if (!project) throw new NotFoundException('Project does not exist');
    if (actor.isExternal && project.organization_id !== actor.organizationId) {
      throw new ForbiddenException('Forbidden');
    }
    if (!canManage(actor)) {
      const member = await tx.project_members.findFirst({
        where: { project_id: id, user_id: actor.userId },
      });
      if (!member) throw new ForbiddenException('Forbidden');
    }
    return project;
  }

  private async toListItem(
    tx: Tx,
    row: { id: string; name: string | null; status: string | null; organization_id: string | null },
  ): Promise<ProjectListItem> {
    const org = row.organization_id
      ? await tx.organizations.findUnique({ where: { id: row.organization_id } })
      : null;
    return {
      id: row.id,
      name: row.name ?? org?.name ?? '',
      status: row.status ?? 'active',
      organization: { id: org?.id ?? '', name: org?.name ?? '', type: org?.type ?? 'other' },
    };
  }

  private async toDetail(
    tx: Tx,
    row: { id: string; name: string | null; status: string | null; organization_id: string | null },
  ): Promise<ProjectDetail> {
    const base = await this.toListItem(tx, row);
    const channel = await tx.channels.findFirst({ where: { project_id: row.id, kind: 'general' } });
    const memberships = await tx.project_members.findMany({ where: { project_id: row.id } });
    const ids = memberships.map((m: { user_id: string | null }) => m.user_id).filter((x: string | null): x is string => !!x);
    const users = ids.length ? await tx.user.findMany({ where: { id: { in: ids } } }) : [];
    return {
      ...base,
      default_channel_id: channel?.id ?? null,
      members: users.map((u: { id: string; displayName: string | null; name: string | null; email: string; role: string }) => ({
        id: u.id,
        display_name: u.displayName ?? u.name ?? u.email,
        role: u.role,
      })),
    };
  }
}
