/**
 * HTTP contract for the auth identity: POST /api/auth/login, GET /api/auth/me
 * and GET /api/users/me return the real identity and refuse deactivated users.
 */
import { CanActivate, ExecutionContext, INestApplication, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request = require('supertest');
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { assertActiveUser } from './auth-identity';
import { UsersController } from '../users/users.controller';
import { UsersService } from '../users/users.service';

const ROWS: Record<string, any> = {
  'u-user': { id: 'u-user', email: 'user@demo.local', name: null, display_name: 'Demo User', role: 'USER', organization_id: 'org-ext', active: true },
  'u-manager': { id: 'u-manager', email: 'manager@demo.local', name: null, display_name: 'Demo Manager', role: 'MANAGER', organization_id: 'org-int', active: true },
  'u-admin': { id: 'u-admin', email: 'admin@demo.local', name: null, display_name: 'Demo Admin', role: 'ADMIN', organization_id: 'org-int', active: true },
  'u-off': { id: 'u-off', email: 'off@demo.local', name: null, display_name: 'Off', role: 'USER', organization_id: 'org-ext', active: false },
};
const byEmail = (email: string) => Object.values(ROWS).find((r) => r.email === email.toLowerCase());

/** Test stand-in for the JWT guard: the session user id comes from a header. */
class HeaderSessionGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const userId = req.headers['x-test-user'];
    if (!userId) throw new UnauthorizedException();
    req.session = { userId, role: ROWS[userId]?.role ?? 'USER', firmId: null };
    return true;
  }
}

describe('auth identity over HTTP', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const authService = {
      login: jest.fn(async ({ email, password }: { email: string; password: string }) => {
        const user = byEmail(email);
        if (!user || password !== 'password1234') throw new UnauthorizedException('invalid credentials');
        assertActiveUser(user);
        return { user, token: 'tok' };
      }),
      getCurrentUser: jest.fn(async (id: string) => {
        const user = ROWS[id];
        if (!user) throw new UnauthorizedException();
        assertActiveUser(user);
        return user;
      }),
    };
    const usersService = { findById: jest.fn(async (id: string) => ROWS[id] ?? null) };
    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController, UsersController],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: UsersService, useValue: usersService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(new HeaderSessionGuard())
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it.each([
    ['user@demo.local', 'USER', 'org-ext', 'Demo User'],
    ['manager@demo.local', 'MANAGER', 'org-int', 'Demo Manager'],
    ['admin@demo.local', 'ADMIN', 'org-int', 'Demo Admin'],
  ])('login as %s returns role %s and organization', async (email, role, organizationId, displayName) => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: 'password1234' })
      .expect(200);
    expect(res.body).toMatchObject({ email, role, organizationId, displayName, active: true });
  });

  it('login refuses a deactivated account with 401', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'off@demo.local', password: 'password1234' })
      .expect(401);
  });

  it.each(['/api/auth/me', '/api/users/me'])('%s returns the real identity', async (path) => {
    const res = await request(app.getHttpServer()).get(path).set('x-test-user', 'u-manager').expect(200);
    expect(res.body).toEqual({
      id: 'u-manager',
      email: 'manager@demo.local',
      name: 'Demo Manager',
      displayName: 'Demo Manager',
      role: 'MANAGER',
      organizationId: 'org-int',
      active: true,
    });
  });

  it.each(['/api/auth/me', '/api/users/me'])('%s refuses a deactivated account', async (path) => {
    await request(app.getHttpServer()).get(path).set('x-test-user', 'u-off').expect(401);
  });

  it.each(['/api/auth/me', '/api/users/me'])('%s refuses a request without a session', async (path) => {
    await request(app.getHttpServer()).get(path).expect(401);
  });
});
