/**
 * Session enforcement (Authentication and Roles story): every authenticated
 * request re-reads the user, so a deactivated (or deleted) user gets 401 and
 * the session cookie is cleared, and an admin's role change takes effect on
 * the user's next request.
 */
import { UnauthorizedException } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';

type Row = { id: string; role: string; active: boolean | null; organizationId: string | null } | null;

function setup(row: Row, payload: Record<string, unknown> = { userId: 'u1', role: 'ADMIN', firmId: null }) {
  const jwt = { verifyAsync: jest.fn().mockResolvedValue(payload) };
  const reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) };
  const findUnique = jest.fn().mockResolvedValue(row);
  const prisma = { runAsAdmin: (fn: (tx: unknown) => unknown) => fn({ user: { findUnique } }) };
  const guard = new JwtAuthGuard(jwt as never, reflector as never, prisma as never);
  const req: Record<string, unknown> = {
    cookies: { session: 'tok' },
    method: 'GET',
    path: '/api/projects',
  };
  const res = { clearCookie: jest.fn() };
  const ctx = {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  };
  return { guard, ctx: ctx as never, req, res, findUnique };
}

describe('session enforcement', () => {
  it('rejects a deactivated user with 401 and clears the session cookie', async () => {
    const { guard, ctx, res } = setup({ id: 'u1', role: 'USER', active: false, organizationId: null });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(res.clearCookie).toHaveBeenCalledWith('session', expect.objectContaining({ maxAge: 0 }));
  });

  it('rejects a deleted user with 401 and clears the session cookie', async () => {
    const { guard, ctx, res } = setup(null);
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(res.clearCookie).toHaveBeenCalled();
  });

  it('re-reads the role on every request (role change takes effect next request)', async () => {
    const { guard, ctx, req, res, findUnique } = setup({ id: 'u1', role: 'MANAGER', active: true, organizationId: 'o1' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'u1' } }));
    expect((req.session as { role: string }).role).toBe('MANAGER');
    expect(res.clearCookie).not.toHaveBeenCalled();
  });

  it('treats a legacy null active flag as active', async () => {
    const { guard, ctx } = setup({ id: 'u1', role: 'USER', active: null, organizationId: null });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('returns 401 without a session cookie', async () => {
    const { guard, ctx, req } = setup({ id: 'u1', role: 'USER', active: true, organizationId: null });
    req.cookies = {};
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
