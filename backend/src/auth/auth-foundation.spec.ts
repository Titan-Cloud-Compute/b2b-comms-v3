/**
 * Unit tests for auth-identity helpers and the AuthService paths that depend
 * on them.  All external I/O is mocked — no database, no bcrypt I/O.
 *
 * Covers:
 *   - toIdentity field mapping
 *   - active === null / undefined counts as active (isActiveUser)
 *   - login refuses active=false without issuing a JWT
 *   - login refuses a wrong password without issuing a JWT
 *   - getCurrentUser refuses active=false
 */

import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';
import { isActiveUser, assertActiveUser, toIdentity } from './auth-identity';
import type { User } from '@prisma/client';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal Prisma User shape for testing. */
function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    email: 'user@demo.local',
    passwordHash: null,
    password_hash: null,
    name: 'Demo User',
    display_name: null,
    role: 'USER' as User['role'],
    organization_id: 'org-1',
    active: true,
    defaultLlmModelId: null,
    grantedModelIds: [],
    quotaResetAt: null,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    created_at: null,
    ...overrides,
  } as unknown as User;
}

// ---------------------------------------------------------------------------
// isActiveUser / assertActiveUser
// ---------------------------------------------------------------------------

describe('isActiveUser', () => {
  it('returns true when active is true', () => {
    expect(isActiveUser({ active: true })).toBe(true);
  });

  it('returns true when active is null (legacy user, no active field set)', () => {
    expect(isActiveUser({ active: null })).toBe(true);
  });

  it('returns true when active is undefined (field absent)', () => {
    expect(isActiveUser({})).toBe(true);
  });

  it('returns false when active is false', () => {
    expect(isActiveUser({ active: false })).toBe(false);
  });
});

describe('assertActiveUser', () => {
  it('does not throw for an active user', () => {
    expect(() => assertActiveUser({ active: true })).not.toThrow();
  });

  it('does not throw when active is null', () => {
    expect(() => assertActiveUser({ active: null })).not.toThrow();
  });

  it('throws UnauthorizedException with generic message for inactive user', () => {
    expect(() => assertActiveUser({ active: false })).toThrow(
      new UnauthorizedException('invalid credentials'),
    );
  });
});

// ---------------------------------------------------------------------------
// toIdentity
// ---------------------------------------------------------------------------

describe('toIdentity', () => {
  it('maps id, email, role, organizationId, active', () => {
    const u = makeUser({ active: true, organization_id: 'org-42' });
    const id = toIdentity(u);
    expect(id.id).toBe('user-1');
    expect(id.email).toBe('user@demo.local');
    expect(id.role).toBe('USER');
    expect(id.organizationId).toBe('org-42');
    expect(id.active).toBe(true);
  });

  it('uses display_name when set', () => {
    const u = makeUser({ display_name: 'Alice Smith', name: 'Alice' });
    const id = toIdentity(u);
    expect(id.name).toBe('Alice Smith');
    expect(id.displayName).toBe('Alice Smith');
  });

  it('falls back to name when display_name is null', () => {
    const u = makeUser({ display_name: null, name: 'Bob' });
    const id = toIdentity(u);
    expect(id.name).toBe('Bob');
    expect(id.displayName).toBe('Bob');
  });

  it('returns null for both name fields when both are null', () => {
    const u = makeUser({ display_name: null, name: null });
    const id = toIdentity(u);
    expect(id.name).toBeNull();
    expect(id.displayName).toBeNull();
  });

  it('sets active=false when user.active is false', () => {
    const u = makeUser({ active: false });
    const id = toIdentity(u);
    expect(id.active).toBe(false);
  });

  it('sets active=true when user.active is null (legacy)', () => {
    const u = makeUser({ active: null });
    const id = toIdentity(u);
    expect(id.active).toBe(true);
  });

  it('organizationId is null when organization_id is absent', () => {
    const u = makeUser({ organization_id: undefined });
    const id = toIdentity(u);
    expect(id.organizationId).toBeNull();
  });

  it('exposes exactly the 7 identity fields and no extras', () => {
    const u = makeUser();
    const id = toIdentity(u);
    expect(Object.keys(id).sort()).toEqual(
      ['active', 'displayName', 'email', 'id', 'name', 'organizationId', 'role'].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// AuthService.login — active check
// ---------------------------------------------------------------------------

function makeAuthService(userOverrides: Partial<User> = {}, bcryptResult = true) {
  const user = makeUser(userOverrides);

  // bcrypt.compare is imported so we need to spy on it.
  jest.spyOn(bcrypt, 'compare').mockImplementation(() => Promise.resolve(bcryptResult as never));

  const findUnique = jest.fn().mockResolvedValue(user);
  const tx = { user: { findUnique } };
  const prisma = {
    runAsAdmin: (fn: (t: typeof tx) => unknown) => fn(tx),
  } as unknown as ConstructorParameters<typeof AuthService>[0];

  const signAsync = jest.fn().mockResolvedValue('jwt-token');
  const jwt = { signAsync } as unknown as ConstructorParameters<typeof AuthService>[1];

  const service = new AuthService(prisma, jwt, {} as never, {} as never);
  return { service, signAsync, findUnique };
}

describe('AuthService.login', () => {
  afterEach(() => jest.restoreAllMocks());

  it('refuses active=false without signing a token (same 401 as bad password)', async () => {
    const { service, signAsync } = makeAuthService({ active: false, passwordHash: 'hash' });
    await expect(service.login({ email: 'user@demo.local', password: 'p' })).rejects.toThrow(
      UnauthorizedException,
    );
    expect(signAsync).not.toHaveBeenCalled();
  });

  it('refuses a wrong password without signing a token', async () => {
    const { service, signAsync } = makeAuthService({ active: true, passwordHash: 'hash' }, false);
    await expect(service.login({ email: 'user@demo.local', password: 'wrong' })).rejects.toThrow(
      UnauthorizedException,
    );
    expect(signAsync).not.toHaveBeenCalled();
  });

  it('issues a token for a valid, active user', async () => {
    const { service, signAsync } = makeAuthService({ active: true, passwordHash: 'hash' }, true);
    const result = await service.login({ email: 'user@demo.local', password: 'correct' });
    expect(signAsync).toHaveBeenCalledTimes(1);
    expect(result.token).toBe('jwt-token');
  });
});

// ---------------------------------------------------------------------------
// AuthService.getCurrentUser — active check
// ---------------------------------------------------------------------------

describe('AuthService.getCurrentUser', () => {
  afterEach(() => jest.restoreAllMocks());

  it('refuses an inactive user with UnauthorizedException', async () => {
    const inactiveUser = makeUser({ active: false });
    const tx = { user: { findUnique: jest.fn().mockResolvedValue(inactiveUser) } };
    const prisma = {
      runAsAdmin: (fn: (t: typeof tx) => unknown) => fn(tx),
    } as unknown as ConstructorParameters<typeof AuthService>[0];
    const service = new AuthService(prisma, {} as never, {} as never, {} as never);

    await expect(service.getCurrentUser('user-1')).rejects.toThrow(UnauthorizedException);
  });

  it('returns the user when active', async () => {
    const activeUser = makeUser({ active: true });
    const tx = { user: { findUnique: jest.fn().mockResolvedValue(activeUser) } };
    const prisma = {
      runAsAdmin: (fn: (t: typeof tx) => unknown) => fn(tx),
    } as unknown as ConstructorParameters<typeof AuthService>[0];
    const service = new AuthService(prisma, {} as never, {} as never, {} as never);

    await expect(service.getCurrentUser('user-1')).resolves.toEqual(activeUser);
  });
});
