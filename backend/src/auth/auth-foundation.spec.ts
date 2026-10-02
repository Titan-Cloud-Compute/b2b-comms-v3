/**
 * Unit tests for auth-identity helpers and AuthService identity-related paths.
 * No database — prisma.runAsAdmin calls the callback against an in-memory stub.
 */

import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { isActiveUser, assertActiveUser, toIdentity } from './auth-identity';
import { AuthService } from './auth.service';
import type { User } from '@prisma/client';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    email: 'user@demo.local',
    name: 'User One',
    passwordHash: null,
    role: 'USER' as any,
    defaultLlmModelId: null,
    grantedModelIds: [],
    quotaResetAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    password_hash: null,
    display_name: null,
    organization_id: 'org-1',
    active: true,
    created_at: null,
    ...overrides,
  } as unknown as User;
}

function makeAuthService(stubbedUser: User | null, jwtSignMock?: jest.Mock) {
  const findUnique = jest.fn().mockResolvedValue(stubbedUser);
  const tx = { user: { findUnique } };
  const prisma = {
    runAsAdmin: (fn: (t: typeof tx) => unknown) => fn(tx),
  } as unknown as ConstructorParameters<typeof AuthService>[0];
  const jwtSign = jwtSignMock ?? jest.fn().mockResolvedValue('mock-token');
  const jwt = { signAsync: jwtSign } as unknown as ConstructorParameters<typeof AuthService>[1];
  const service = new AuthService(prisma, jwt, {} as never, {} as never);
  return { service, findUnique, jwtSign };
}

// ---------------------------------------------------------------------------
// isActiveUser
// ---------------------------------------------------------------------------

describe('isActiveUser', () => {
  it('returns true when active is true', () => {
    expect(isActiveUser({ active: true })).toBe(true);
  });

  it('returns true when active is null (unset)', () => {
    expect(isActiveUser({ active: null })).toBe(true);
  });

  it('returns false when active is explicitly false', () => {
    expect(isActiveUser({ active: false })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// assertActiveUser
// ---------------------------------------------------------------------------

describe('assertActiveUser', () => {
  it('does not throw for an active user', () => {
    expect(() => assertActiveUser({ active: true })).not.toThrow();
  });

  it('does not throw when active is null', () => {
    expect(() => assertActiveUser({ active: null })).not.toThrow();
  });

  it('throws UnauthorizedException for an inactive user', () => {
    expect(() => assertActiveUser({ active: false })).toThrow(UnauthorizedException);
  });

  it('uses a generic message that does not reveal account existence', () => {
    try {
      assertActiveUser({ active: false });
      fail('expected to throw');
    } catch (e: unknown) {
      expect(e).toBeInstanceOf(UnauthorizedException);
      const msg = (e as UnauthorizedException).message;
      expect(msg).toBe('invalid credentials');
    }
  });
});

// ---------------------------------------------------------------------------
// toIdentity
// ---------------------------------------------------------------------------

describe('toIdentity', () => {
  it('maps all fields correctly with display_name set', () => {
    const user = makeUser({ display_name: 'Display Name', name: 'Name' });
    const identity = toIdentity(user);
    expect(identity).toEqual({
      id: 'user-1',
      email: 'user@demo.local',
      name: 'Display Name',
      displayName: 'Display Name',
      role: 'USER',
      organizationId: 'org-1',
      active: true,
    });
  });

  it('falls back to name when display_name is null', () => {
    const user = makeUser({ display_name: null, name: 'Fallback Name' });
    const identity = toIdentity(user);
    expect(identity.name).toBe('Fallback Name');
    expect(identity.displayName).toBe('Fallback Name');
  });

  it('returns null for name when both display_name and name are null', () => {
    const user = makeUser({ display_name: null, name: null });
    const identity = toIdentity(user);
    expect(identity.name).toBeNull();
    expect(identity.displayName).toBeNull();
  });

  it('null active counts as active in the identity', () => {
    const user = makeUser({ active: null });
    const identity = toIdentity(user);
    expect(identity.active).toBe(true);
  });

  it('active=false results in active:false', () => {
    const user = makeUser({ active: false });
    const identity = toIdentity(user);
    expect(identity.active).toBe(false);
  });

  it('organization_id is returned as organizationId', () => {
    const user = makeUser({ organization_id: 'org-abc' });
    const identity = toIdentity(user);
    expect(identity.organizationId).toBe('org-abc');
  });

  it('null organization_id maps to null', () => {
    const user = makeUser({ organization_id: null });
    const identity = toIdentity(user);
    expect(identity.organizationId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AuthService.login — active account check
// ---------------------------------------------------------------------------

describe('AuthService.login — active check', () => {
  it('refuses an inactive account without signing a token', async () => {
    const hash = await bcrypt.hash('secret123', 1);
    const inactiveUser = makeUser({ active: false, passwordHash: hash });
    const { service, jwtSign } = makeAuthService(inactiveUser);

    await expect(
      service.login({ email: 'user@demo.local', password: 'secret123' }),
    ).rejects.toThrow(UnauthorizedException);

    expect(jwtSign).not.toHaveBeenCalled();
  });

  it('refuses a wrong password', async () => {
    const hash = await bcrypt.hash('secret123', 1);
    const user = makeUser({ active: true, passwordHash: hash });
    const { service, jwtSign } = makeAuthService(user);

    await expect(
      service.login({ email: 'user@demo.local', password: 'wrong-password' }),
    ).rejects.toThrow(UnauthorizedException);

    expect(jwtSign).not.toHaveBeenCalled();
  });

  it('succeeds for an active account with the correct password', async () => {
    const hash = await bcrypt.hash('secret123', 1);
    const user = makeUser({ active: true, passwordHash: hash });
    const { service, jwtSign } = makeAuthService(user);

    const result = await service.login({
      email: 'user@demo.local',
      password: 'secret123',
    });

    expect(result.user.id).toBe('user-1');
    expect(jwtSign).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// AuthService.getCurrentUser — active account check
// ---------------------------------------------------------------------------

describe('AuthService.getCurrentUser — active check', () => {
  it('throws UnauthorizedException for an inactive user', async () => {
    const inactiveUser = makeUser({ active: false });
    const { service } = makeAuthService(inactiveUser);

    await expect(service.getCurrentUser('user-1')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('returns the user when the account is active', async () => {
    const user = makeUser({ active: true });
    const { service } = makeAuthService(user);

    const result = await service.getCurrentUser('user-1');
    expect(result.id).toBe('user-1');
  });

  it('returns the user when active is null (unset)', async () => {
    const user = makeUser({ active: null });
    const { service } = makeAuthService(user);

    const result = await service.getCurrentUser('user-1');
    expect(result.id).toBe('user-1');
  });
});
