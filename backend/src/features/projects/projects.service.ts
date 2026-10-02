import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { SessionPayload } from '../../auth/session.types';
import {
  Actor,
  AddMemberInput,
  CreateProjectInput,
  DEFAULT_CHANNEL_NAME,
  ListQuery,
  PROJECT_STATUS_ACTIVE,
  PROJECT_STATUS_ARCHIVED,
  ProjectFacts,
  UpdateProjectInput,
  canArchiveProject,
  canCreateProject,
  canViewProject,
  canWriteProject,
  seesAllProjects,
} from './projects.policy';

export interface ProjectDto {
  id: string;
  name: string;
  status: string;
  organizationId: string;
  organizationName: string;
  organizationType: string;
  createdAt: Date;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ProjectRow = any;

function toDto(p: ProjectRow): ProjectDto {
  return {
    id: p.id,
    name: p.name,
    status: p.status,
    organizationId: p.organization_id,
    organizationName: p.organization?.name ?? '',
    organizationType: p.organization?.type ?? '',
    createdAt: p.created_at,
  };
}

@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Resolve the caller's organization facts (external = org is not internal). */
  async resolveActor(session: SessionPayload): Promise<Actor> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = this.prisma as any;
    let organizationId = session.organizationId ?? null;
    if (organizationId === null) {
      const user = await db.user.findUnique({
        where: { id: session.userId },
        select: { organization_id: true },
      });
      organizationId = user?.organization_id ?? null;
    }
    let isExternal = false;
    if (organizationId) {
      const org = await db.organizations.findUnique({
        where: { id: organizationId },
        select: { is_internal: true },
      });
      isExternal = org ? !org.is_internal : false;
    }
    return { userId: session.userId, role: session.role, organizationId, isExternal };
  }

  async list(actor: Actor, q: ListQuery) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = this.prisma as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {};
    if (!q.includeArchived) where.status = { not: PROJECT_STATUS_ARCHIVED };
    if (!seesAllProjects(actor)) where.members = { some: { user_id: actor.userId } };
    if (actor.isExternal) where.organization_id = actor.organizationId ?? '__none__';
    const [rows, total] = await Promise.all([
      db.projects.findMany({
        where,
        include: { organization: true },
        orderBy: { created_at: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      db.projects.count({ where }),
    ]);
    return { items: rows.map(toDto), total, page: q.page, pageSize: q.pageSize };
  }

  async create(actor: Actor, input: CreateProjectInput): Promise<ProjectDto> {
    if (!canCreateProject(actor)) throw new ForbiddenException('only managers and admins can create projects');
    const orgName = input.organizationName.trim();
    if (!orgName) throw new BadRequestException('organizationName must not be blank');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = this.prisma as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const created = await db.$transaction(async (tx: any) => {
      const org = await tx.organizations.create({
        data: { name: orgName, type: input.organizationType, is_internal: false },
      });
      const project = await tx.projects.create({
        data: {
          organization_id: org.id,
          name: input.name?.trim() || orgName,
          status: PROJECT_STATUS_ACTIVE,
          created_by: actor.userId,
        },
      });
      await tx.project_members.create({ data: { project_id: project.id, user_id: actor.userId } });
      await tx.channels.create({
        data: {
          project_id: project.id,
          kind: 'general',
          name: DEFAULT_CHANNEL_NAME,
          internal_only: false,
          status: 'open',
          created_by: actor.userId,
        },
      });
      return { ...project, organization: org };
    });
    return toDto(created);
  }

  private async loadFacts(id: string): Promise<{ row: ProjectRow; facts: ProjectFacts }> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = this.prisma as any;
    const row = await db.projects.findUnique({
      where: { id },
      include: { organization: true, members: { select: { user_id: true } } },
    });
    if (!row) throw new NotFoundException('project not found');
    return {
      row,
      facts: {
        organizationId: row.organization_id,
        status: row.status,
        memberUserIds: (row.members ?? []).map((m: { user_id: string }) => m.user_id),
      },
    };
  }

  async get(actor: Actor, id: string): Promise<ProjectDto> {
    const { row, facts } = await this.loadFacts(id);
    if (!canViewProject(actor, facts)) throw new ForbiddenException('forbidden');
    return toDto(row);
  }

  async update(actor: Actor, id: string, input: UpdateProjectInput): Promise<ProjectDto> {
    const { facts } = await this.loadFacts(id);
    if (!canWriteProject(actor, facts)) throw new ForbiddenException('forbidden');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = this.prisma as any;
    const row = await db.projects.update({
      where: { id },
      data: input.name ? { name: input.name } : {},
      include: { organization: true },
    });
    return toDto(row);
  }

  async archive(actor: Actor, id: string): Promise<ProjectDto> {
    const { facts } = await this.loadFacts(id);
    if (!canArchiveProject(actor)) throw new ForbiddenException('only admins can archive projects');
    if (facts.status === PROJECT_STATUS_ARCHIVED) throw new ForbiddenException('project is archived');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = this.prisma as any;
    const row = await db.projects.update({
      where: { id },
      data: { status: PROJECT_STATUS_ARCHIVED },
      include: { organization: true },
    });
    return toDto(row);
  }

  async addMember(actor: Actor, id: string, input: AddMemberInput) {
    const { facts } = await this.loadFacts(id);
    if (!canWriteProject(actor, facts)) throw new ForbiddenException('forbidden');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = this.prisma as any;
    const user = await db.user.findUnique({ where: { id: input.userId }, select: { id: true } });
    if (!user) throw new BadRequestException('user not found');
    await db.project_members.upsert({
      where: { project_id_user_id: { project_id: id, user_id: input.userId } },
      create: { project_id: id, user_id: input.userId },
      update: {},
    });
    return { projectId: id, userId: input.userId };
  }
}
