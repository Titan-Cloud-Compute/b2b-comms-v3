/**
 * Auth foundation (full_auth): login and the current-user lookup return the
 * REAL identity (role, organizationId, active, display name) and refuse a
 * deactivated account.
 */
import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';
import { toIdentity, assertActiveUser, isActiveUser } from './auth-identity';

const baseRow = {
  id: 'u-1',
  email: 'manager@demo.local',
  name: null,
  display_name: 'Demo Manager',
  role: 'MANAGER',
  organization_id: 'org-internal',
  active: true,
};

function makeService(row: Record<string, unknown> | null) {
  const tx = { user: { findUnique: jest.fn().mockResolvedValue(row) } };
  const prisma = { runAsAdmin: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)) };
  const jwt = { signAsync: jest.fn().mockResolvedValue('signed-token') };
  const service = new (AuthService as any)(prisma, jwt, {}, {}) as AuthService;
  return { service, jwt };
}

describe('toIdentity', () => {
  it('maps the auth row to the real identity', () => {
    expect(toIdentity(baseRow)).toEqual({
      id: 'u-1',
      email: 'manager@demo.local',
      name: 'Demo Manager',
      displayName: 'Demo Manager',
      role: 'MANAGER',
      organizationId: 'org-internal',
      active: true,
    });
  });

  it('falls back to name and treats a NULL active (legacy row) as active', () => {
    const id = toIdentity({ ...baseRow, display_name: null, name: 'Legacy', active: null, organization_id: null });
    expect(id.displayName).toBe('Legacy');
    expect(id.active).toBe(true);
    expect(id.organizationId).toBeNull();
  });

  it('only an explicit false deactivates', () => {
    expect(isActiveUser({ active: false })).toBe(false);
    expect(() => assertActiveUser({ active: false })).toThrow(UnauthorizedException);
    expect(() => assertActiveUser({ active: true })).not.toThrow();
  });
});

describe('AuthService identity', () => {
  let passwordHash: string;
  beforeAll(async () => {
    passwordHash = await bcrypt.hash('password1234', 4);
  });

  it('login with valid credentials returns the user and a token', async () => {
    const { service } = makeService({ ...baseRow, passwordHash });
    const { user, token } = await service.login({ email: 'Manager@demo.local', password: 'password1234' });
    expect(token).toBe('signed-token');
    expect(toIdentity(user as any)).toMatchObject({ role: 'MANAGER', organizationId: 'org-internal', active: true });
  });

  it('login refuses a deactivated account even with the right password', async () => {
    const { service, jwt } = makeService({ ...baseRow, passwordHash, active: false });
    await expect(service.login({ email: 'manager@demo.local', password: 'password1234' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(jwt.signAsync).not.toHaveBeenCalled();
  });

  it('login refuses a wrong password', async () => {
    const { service } = makeService({ ...baseRow, passwordHash });
    await expect(service.login({ email: 'manager@demo.local', password: 'nope' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('getCurrentUser refuses a deactivated account (existing sessions stop working)', async () => {
    const { service } = makeService({ ...baseRow, passwordHash, active: false });
    await expect(service.getCurrentUser('u-1')).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
