import {
  Actor,
  ProjectFacts,
  addMemberSchema,
  canArchiveProject,
  canCreateProject,
  canViewProject,
  canWriteProject,
  createProjectSchema,
  listQuerySchema,
  seesAllProjects,
  updateProjectSchema,
} from './projects.policy';

const internal = (role: Actor['role'], userId = 'u-' + role): Actor => ({
  userId,
  role,
  organizationId: 'org-internal',
  isExternal: false,
});
const external = (orgId: string, userId = 'ext-1'): Actor => ({
  userId,
  role: 'USER',
  organizationId: orgId,
  isExternal: true,
});
const project = (over: Partial<ProjectFacts> = {}): ProjectFacts => ({
  organizationId: 'org-a',
  status: 'active',
  memberUserIds: [],
  ...over,
});

describe('projects policy', () => {
  it('only managers and admins can create projects', () => {
    expect(canCreateProject(internal('ADMIN'))).toBe(true);
    expect(canCreateProject(internal('MANAGER'))).toBe(true);
    expect(canCreateProject(internal('USER'))).toBe(false);
    expect(canCreateProject(external('org-a'))).toBe(false);
  });

  it('only admins can archive', () => {
    expect(canArchiveProject(internal('ADMIN'))).toBe(true);
    expect(canArchiveProject(internal('MANAGER'))).toBe(false);
    expect(canArchiveProject(internal('USER'))).toBe(false);
  });

  it('admins and managers see all; employees only assigned projects', () => {
    expect(seesAllProjects(internal('ADMIN'))).toBe(true);
    expect(seesAllProjects(internal('MANAGER'))).toBe(true);
    expect(seesAllProjects(internal('USER'))).toBe(false);
    const emp = internal('USER', 'emp-1');
    expect(canViewProject(emp, project({ memberUserIds: ['emp-1'] }))).toBe(true);
    expect(canViewProject(emp, project())).toBe(false);
  });

  it('external users cannot see another company project even if listed as member', () => {
    const ext = external('org-a', 'ext-1');
    expect(canViewProject(ext, project({ organizationId: 'org-a', memberUserIds: ['ext-1'] }))).toBe(true);
    expect(canViewProject(ext, project({ organizationId: 'org-b', memberUserIds: ['ext-1'] }))).toBe(false);
    expect(canViewProject(ext, project({ organizationId: 'org-a' }))).toBe(false);
  });

  it('archived projects reject writes', () => {
    expect(canWriteProject(internal('ADMIN'), project())).toBe(true);
    expect(canWriteProject(internal('ADMIN'), project({ status: 'archived' }))).toBe(false);
    expect(canWriteProject(internal('USER', 'e'), project({ memberUserIds: ['e'] }))).toBe(false);
  });
});

describe('projects schemas', () => {
  it('rejects a blank organization name', () => {
    expect(createProjectSchema.safeParse({ organizationName: '   ', organizationType: 'vendor' }).success).toBe(false);
    expect(createProjectSchema.safeParse({ organizationType: 'vendor' }).success).toBe(false);
  });

  it('accepts only vendor/customer/client/other', () => {
    for (const t of ['vendor', 'customer', 'client', 'other']) {
      expect(createProjectSchema.safeParse({ organizationName: 'Acme', organizationType: t }).success).toBe(true);
    }
    expect(createProjectSchema.safeParse({ organizationName: 'Acme', organizationType: 'partner' }).success).toBe(false);
  });

  it('trims the organization name', () => {
    const r = createProjectSchema.parse({ organizationName: '  Acme  ', organizationType: 'client' });
    expect(r.organizationName).toBe('Acme');
  });

  it('list query defaults and bounds', () => {
    expect(listQuerySchema.parse({})).toEqual({ page: 1, pageSize: 25, includeArchived: false });
    expect(listQuerySchema.safeParse({ pageSize: '500' }).success).toBe(false);
    expect(listQuerySchema.parse({ page: '2', includeArchived: 'true' }).includeArchived).toBe(true);
  });

  it('update and member schemas', () => {
    expect(updateProjectSchema.safeParse({ name: '' }).success).toBe(false);
    expect(updateProjectSchema.safeParse({ status: 'archived' }).success).toBe(false);
    expect(addMemberSchema.safeParse({ userId: '' }).success).toBe(false);
    expect(addMemberSchema.safeParse({ userId: 'u-1' }).success).toBe(true);
  });
});
