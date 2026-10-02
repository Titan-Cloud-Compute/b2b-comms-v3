/**
 * Foundation: auth (full_auth). Pins:
 *  - a deactivated user is refused at login even with the right password;
 *  - the session token carries organizationId;
 *  - /api/auth/me and /api/users/me return the real identity
 *    (id, role, organizationId, active) instead of an empty object.
 */
import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import type { User } from '@prisma/client';
import { AuthService } from './auth.service';
import { AuthController, toIdentity } from './auth.controller';
import { UsersController } from '../users/users.controller';
import type { UsersService } from '../users/users.service';

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: '7f1c2b8e-3a4d-4e5f-9a6b-1c2d3e4f5a6b',
    email: 'user@demo.local',
    passwordHash: bcrypt.hashSync('correct-horse', 4),
    name: 'Demo User',
    role: 'MANAGER',
    defaultLlmModelId: null,
    grantedModelIds: [],
    quotaResetAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    password_hash: null,
    display_name: 'Demo Manager',
    organization_id: '0b6f8a1e-2c3d-4e5f-8a9b-0c1d2e3f4a5b',
    active: true,
    created_at: new Date(),
    ...overrides,
  } as User;
}

function makeService(user: User | null) {
  const findUnique = jest.fn().mockResolvedValue(user);
  const tx = { user: { findUnique } };
  const prisma = {
    runAsAdmin: (fn: (t: typeof tx) => unknown) => fn(tx),
  } as unknown as ConstructorParameters<typeof AuthService>[0];
  const signAsync = jest.fn().mockImplementation(async (p: unknown) => JSON.stringify(p));
  const jwt = { signAsync } as unknown as ConstructorParameters<typeof AuthService>[1];
  const service = new AuthService(prisma, jwt, {} as never, {} as never);
  return { service, signAsync, findUnique };
}

describe('AuthService.login — full_auth foundation', () => {
  it('refuses a deactivated user even with the correct password', async () => {
    const { service, signAsync } = makeService(makeUser({ active: false }));
    await expect(
      service.login({ email: 'user@demo.local', password: 'correct-horse' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(signAsync).not.toHaveBeenCalled();
  });

  it('signs an active user in and carries organizationId in the session', async () => {
    const user = makeUser();
    const { service, signAsync } = makeService(user);
    const result = await service.login({ email: 'USER@demo.local ', password: 'correct-horse' });
    expect(result.user.id).toBe(user.id);
    expect(signAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: user.id,
        role: 'MANAGER',
        organizationId: user.organization_id,
      }),
    );
  });

  it('still rejects a wrong password with the generic message', async () => {
    const { service } = makeService(makeUser());
    await expect(
      service.login({ email: 'user@demo.local', password: 'nope' }),
    ).rejects.toThrow('invalid credentials');
  });
});

describe('identity endpoints', () => {
  const user = makeUser();
  const req = { session: { userId: user.id, role: user.role, firmId: null } } as never;

  it('toIdentity exposes id, role, organizationId and active', () => {
    expect(toIdentity(user)).toMatchObject({
      id: user.id,
      email: user.email,
      role: 'MANAGER',
      organizationId: user.organization_id,
      active: true,
    });
  });

  it('GET /api/auth/me returns the real identity', async () => {
    const authService = { getCurrentUser: jest.fn().mockResolvedValue(user) };
    const controller = new AuthController(authService as never);
    await expect(controller.getMe(req)).resolves.toMatchObject({
      id: user.id,
      role: 'MANAGER',
      organizationId: user.organization_id,
      active: true,
    });
    expect(authService.getCurrentUser).toHaveBeenCalledWith(user.id);
  });

  it('GET /api/users/me returns the real identity, not an empty object', async () => {
    const users = { findSessionUser: jest.fn().mockResolvedValue(user) } as unknown as UsersService;
    const controller = new UsersController(users);
    const body = await controller.getMe(req);
    expect(body).toMatchObject({
      id: user.id,
      role: 'MANAGER',
      organizationId: user.organization_id,
      active: true,
    });
  });
});
