/**
 * Foundation: auth (full_auth) — login refuses deactivated users and signs the
 * user's organizationId into the session payload.
 */
import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AuthService, toIdentity } from './auth.service';
import type { SessionPayload } from './session.types';

type Row = Record<string, unknown>;

async function makeService(row: Row | null) {
  const tx = { user: { findUnique: jest.fn().mockResolvedValue(row) } };
  const prisma = { runAsAdmin: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)) };
  const signed: SessionPayload[] = [];
  const jwt = {
    signAsync: jest.fn(async (p: SessionPayload) => {
      signed.push(p);
      return 'signed-token';
    }),
  };
  const service = new (AuthService as any)(prisma, jwt, {}, {}) as AuthService;
  return { service, signed };
}

async function userRow(overrides: Row = {}): Promise<Row> {
  return {
    id: 'u1',
    email: 'manager@demo.local',
    passwordHash: await bcrypt.hash('secret-pass', 4),
    name: null,
    display_name: 'Demo Manager',
    role: 'MANAGER',
    organization_id: 'org-1',
    active: true,
    ...overrides,
  };
}

describe('AuthService foundation', () => {
  it('signs organizationId and the real role into the session', async () => {
    const { service, signed } = await makeService(await userRow());
    const { token } = await service.login({ email: 'manager@demo.local', password: 'secret-pass' });
    expect(token).toBe('signed-token');
    expect(signed[0]).toMatchObject({ userId: 'u1', role: 'MANAGER', organizationId: 'org-1' });
  });

  it('refuses a deactivated user even with the right password', async () => {
    const { service, signed } = await makeService(await userRow({ active: false }));
    await expect(
      service.login({ email: 'manager@demo.local', password: 'secret-pass' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(signed).toHaveLength(0);
  });

  it('rejects a wrong password', async () => {
    const { service } = await makeService(await userRow());
    await expect(
      service.login({ email: 'manager@demo.local', password: 'nope' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('treats a legacy row with active=null as active', async () => {
    const { service } = await makeService(await userRow({ active: null }));
    await expect(
      service.login({ email: 'manager@demo.local', password: 'secret-pass' }),
    ).resolves.toMatchObject({ token: 'signed-token' });
  });

  it('toIdentity exposes role, organizationId and display name', async () => {
    const row = (await userRow()) as any;
    expect(toIdentity(row)).toMatchObject({
      id: 'u1',
      email: 'manager@demo.local',
      name: 'Demo Manager',
      role: 'MANAGER',
      organizationId: 'org-1',
      active: true,
    });
  });
});
