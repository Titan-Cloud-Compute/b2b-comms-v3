/**
 * Story: Authentication and Roles — admin user CRUD and invitation accept.
 * Unit level: prisma is mocked; role enforcement is asserted via metadata
 * and RolesGuard (non-admins get 403).
 */
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard, ROLES_KEY } from '../../auth/roles.guard';
import { IS_PUBLIC_KEY } from '../../auth/decorators/public.decorator';
import {
  AuthenticationAndRolesService,
  hashInvitationToken,
} from './authentication-and-roles.service';
import {
  InvitationsAcceptController,
  UsersAdminController,
} from './authentication-and-roles.controller';

const now = new Date('2026-01-01T00:00:00Z');
const userRow = {
  id: 'u1',
  email: 'new@demo.local',
  name: 'New',
  displayName: 'New',
  role: 'USER',
  organizationId: 'org-1',
  active: true,
  created_at: now,
  createdAt: now,
};

function makeService(tx: Record<string, unknown>) {
  const prisma = { runAsAdmin: (fn: (t: unknown) => unknown) => fn(tx) };
  return new AuthenticationAndRolesService(prisma as never);
}

function rolesCtx(role: string) {
  return {
    getHandler: () => UsersAdminController.prototype.list,
    getClass: () => UsersAdminController,
    switchToHttp: () => ({ getRequest: () => ({ session: { userId: 'x', role, firmId: null } }) }),
  } as never;
}

describe('user administration', () => {
  it('is admin-only: MANAGER and USER get 403, ADMIN passes', () => {
    const guard = new RolesGuard(new Reflector());
    expect(Reflect.getMetadata(ROLES_KEY, UsersAdminController)).toEqual(['ADMIN']);
    for (const role of ['MANAGER', 'USER']) {
      expect(() => guard.canActivate(rolesCtx(role))).toThrow(ForbiddenException);
    }
    expect(guard.canActivate(rolesCtx('ADMIN'))).toBe(true);
  });

  it('lists users with page and total', async () => {
    const svc = makeService({
      user: { findMany: jest.fn().mockResolvedValue([userRow]), count: jest.fn().mockResolvedValue(1) },
    });
    const res = await svc.listUsers(1, 50);
    expect(res).toEqual({
      items: [
        {
          id: 'u1',
          email: 'new@demo.local',
          display_name: 'New',
          role: 'USER',
          organization_id: 'org-1',
          active: true,
          created_at: now.toISOString(),
        },
      ],
      page: 1,
      total: 1,
    });
  });

  it('creates a user', async () => {
    const create = jest.fn().mockResolvedValue(userRow);
    const svc = makeService({ user: { findUnique: jest.fn().mockResolvedValue(null), create } });
    const res = await svc.createUser({ email: 'New@demo.local', password: 'password1', role: 'USER', display_name: 'New' });
    expect(res.id).toBe('u1');
    expect(create.mock.calls[0][0].data.email).toBe('new@demo.local');
    expect(create.mock.calls[0][0].data.passwordHash).not.toBe('password1');
  });

  it('deactivates and changes role via PATCH', async () => {
    const update = jest.fn().mockResolvedValue({ ...userRow, role: 'MANAGER', active: false });
    const svc = makeService({ user: { findUnique: jest.fn().mockResolvedValue(userRow), update } });
    const res = await svc.updateUser('u1', { role: 'MANAGER', active: false });
    expect(update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { role: 'MANAGER', active: false } });
    expect(res).toEqual({ id: 'u1', email: 'new@demo.local', display_name: 'New', role: 'MANAGER', active: false });
  });

  it('rejects a blank create payload with 400', () => {
    const ctrl = new UsersAdminController(makeService({}));
    expect(() => ctrl.create({ email: '', password: '', role: 'USER' })).toThrow(BadRequestException);
  });
});

describe('POST /api/invitations/accept', () => {
  const pending = {
    id: 'inv1',
    project_id: 'p1',
    email: 'guest@ext.example',
    token_hash: hashInvitationToken('tok'),
    status: 'pending',
    expires_at: new Date(Date.now() + 86_400_000),
  };

  function invTx(invitation: unknown) {
    const userCreate = jest.fn().mockResolvedValue({ ...userRow, email: 'guest@ext.example' });
    return {
      userCreate,
      tx: {
        invitations: { findFirst: jest.fn().mockResolvedValue(invitation), update: jest.fn() },
        projects: { findUnique: jest.fn().mockResolvedValue({ id: 'p1', organization_id: 'org-x' }) },
        project_members: { create: jest.fn() },
        user: { findUnique: jest.fn().mockResolvedValue(null), create: userCreate },
      },
    };
  }

  it('is public', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, InvitationsAcceptController.prototype.accept)).toBe(true);
  });

  it('creates the user for a valid pending invitation', async () => {
    const { tx, userCreate } = invTx(pending);
    const res = await makeService(tx).acceptInvitation({ token: 'tok', display_name: 'Guest', password: 'password1' });
    expect(res.email).toBe('guest@ext.example');
    expect(userCreate).toHaveBeenCalled();
    expect(tx.invitations.update).toHaveBeenCalledWith({ where: { id: 'inv1' }, data: { status: 'accepted' } });
  });

  for (const [label, inv] of [
    ['expired', { ...pending, expires_at: new Date(Date.now() - 1000) }],
    ['already accepted', { ...pending, status: 'accepted' }],
    ['unknown', null],
  ] as const) {
    it(`returns 400 and creates no user for an ${label} token`, async () => {
      const { tx, userCreate } = invTx(inv);
      await expect(
        makeService(tx).acceptInvitation({ token: 'tok', display_name: 'Guest', password: 'password1' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(userCreate).not.toHaveBeenCalled();
    });
  }

  it('rejects a blank payload with 400', () => {
    const ctrl = new InvitationsAcceptController(makeService({}));
    expect(() => ctrl.accept({})).toThrow(BadRequestException);
  });
});
