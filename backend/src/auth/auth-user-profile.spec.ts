/**
 * Auth user profile (full_auth foundation): login and me expose
 * displayName / organizationId / active, and inactive accounts are rejected.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import * as bcrypt from 'bcryptjs';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { toAuthUserProfile } from './auth.controller';

function makeService(user: Record<string, unknown> | null) {
  const findUnique = jest.fn().mockResolvedValue(user);
  const tx = { user: { findUnique } };
  const prisma = {
    runAsAdmin: (fn: (t: typeof tx) => unknown) => fn(tx),
  } as unknown as ConstructorParameters<typeof AuthService>[0];
  const service = new AuthService(prisma, {} as never, {} as never, {} as never);
  (service as unknown as { issueToken: () => Promise<string> }).issueToken = async () => 'tok';
  return service;
}

const baseUser = {
  id: 'u1',
  email: 'manager@demo.local',
  name: 'Manager',
  role: 'MANAGER',
  displayName: 'Mona Manager',
  organizationId: 'org-1',
};

describe('auth user profile', () => {
  it('rejects login for an inactive account', async () => {
    const passwordHash = await bcrypt.hash('secret123', 4);
    const service = makeService({ ...baseUser, passwordHash, active: false });
    await expect(
      service.login({ email: 'manager@demo.local', password: 'secret123' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('allows login for an active (or legacy null) account', async () => {
    const passwordHash = await bcrypt.hash('secret123', 4);
    for (const active of [true, null]) {
      const service = makeService({ ...baseUser, passwordHash, active });
      const { user } = await service.login({ email: 'manager@demo.local', password: 'secret123' });
      expect(user.id).toBe('u1');
    }
  });

  it('exposes displayName, organizationId and active without the hash', () => {
    const profile = toAuthUserProfile({
      ...baseUser,
      passwordHash: 'x',
      active: true,
    } as never);
    expect(profile).toMatchObject({
      id: 'u1',
      email: 'manager@demo.local',
      role: 'MANAGER',
      displayName: 'Mona Manager',
      organizationId: 'org-1',
      active: true,
    });
    expect(JSON.stringify(profile)).not.toContain('passwordHash');
  });

  it('schema maps the profile fields onto the snake_case columns', () => {
    const schema = readFileSync(join(__dirname, '..', '..', 'prisma', 'schema.prisma'), 'utf8');
    expect(schema).toMatch(/displayName\s+String\?\s+@map\("display_name"\)/);
    expect(schema).toMatch(/organizationId\s+String\?\s+@map\("organization_id"\)/);
  });
});
