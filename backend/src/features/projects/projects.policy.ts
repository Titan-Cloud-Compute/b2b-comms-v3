import { z } from 'zod';

/**
 * Pure access policy + request schemas for the Projects story.
 * No I/O here so the rules are unit-testable in isolation.
 */

export const ORGANIZATION_TYPES = ['vendor', 'customer', 'client', 'other'] as const;
export type OrganizationType = (typeof ORGANIZATION_TYPES)[number];

export const PROJECT_STATUS_ACTIVE = 'active';
export const PROJECT_STATUS_ARCHIVED = 'archived';
export const DEFAULT_CHANNEL_NAME = 'general';

export type Role = 'ADMIN' | 'MANAGER' | 'USER';

/** The caller as seen by the policy. */
export interface Actor {
  userId: string;
  role: Role;
  organizationId: string | null;
  /** True when the caller's organization is an external (non-internal) organization. */
  isExternal: boolean;
}

/** The minimum project facts the policy needs. */
export interface ProjectFacts {
  organizationId: string;
  status: string;
  memberUserIds: readonly string[];
}

export const createProjectSchema = z.object({
  organizationName: z
    .string({ required_error: 'organizationName is required' })
    .trim()
    .min(1, 'organizationName must not be blank')
    .max(200, 'organizationName is too long'),
  organizationType: z.enum(ORGANIZATION_TYPES, {
    errorMap: () => ({ message: 'organizationType must be one of vendor, customer, client, other' }),
  }),
  name: z.string().trim().max(200).optional(),
});
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const updateProjectSchema = z
  .object({
    name: z.string().trim().min(1, 'name must not be blank').max(200).optional(),
  })
  .strict();
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

export const addMemberSchema = z.object({
  userId: z.string().trim().min(1, 'userId is required'),
});
export type AddMemberInput = z.infer<typeof addMemberSchema>;

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  includeArchived: z
    .union([z.literal('true'), z.literal('false'), z.boolean()])
    .optional()
    .transform((v) => v === true || v === 'true'),
});
export type ListQuery = z.infer<typeof listQuerySchema>;

/** Only internal Managers and Admins may create projects. */
export function canCreateProject(actor: Actor): boolean {
  if (actor.isExternal) return false;
  return actor.role === 'ADMIN' || actor.role === 'MANAGER';
}

/** Only Admins may archive. */
export function canArchiveProject(actor: Actor): boolean {
  return !actor.isExternal && actor.role === 'ADMIN';
}

/** Internal Admins/Managers see every project; everyone else only projects they are a member of. */
export function seesAllProjects(actor: Actor): boolean {
  return !actor.isExternal && (actor.role === 'ADMIN' || actor.role === 'MANAGER');
}

/**
 * Read access. External users must belong to the project's organization AND be
 * a member — any other company's project is forbidden.
 */
export function canViewProject(actor: Actor, project: ProjectFacts): boolean {
  if (actor.isExternal) {
    if (!actor.organizationId || actor.organizationId !== project.organizationId) return false;
    return project.memberUserIds.includes(actor.userId);
  }
  if (seesAllProjects(actor)) return true;
  return project.memberUserIds.includes(actor.userId);
}

/** Write access (PATCH, add member). Archived projects are read-only for everyone. */
export function canWriteProject(actor: Actor, project: ProjectFacts): boolean {
  if (project.status === PROJECT_STATUS_ARCHIVED) return false;
  if (!canViewProject(actor, project)) return false;
  return !actor.isExternal && (actor.role === 'ADMIN' || actor.role === 'MANAGER');
}
