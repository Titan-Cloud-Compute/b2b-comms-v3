/**
 * HTTP-level integration tests for the identity endpoints.
 *
 * Uses @nestjs/testing + supertest. JwtAuthGuard is replaced with a
 * header-based stand-in (x-test-user-id) so we can control the session
 * without real JWTs, while AuthService and UsersService are fully mocked.
 *
 * Verifies:
 *   POST /api/auth/login  — 200 with identity (role USER / MANAGER / ADMIN);
 *                           401 for an inactive account.
 *   GET  /api/auth/me     — 200 with identity; 401 inactive; 401 no session.
 *   GET  /api/users/me    — 200 with identity; 401 inactive; 401 no session.
 */

import { CanActivate, ExecutionContext, INestApplication, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const cookieParser = require('cookie-parser');
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { UsersController } from '../users/users.controller';
import { UsersService } from '../users/users.service';
import { GlobalExceptionFilter } from '../common/global-exception.filter';
import type { User } from '@prisma/client';
import type { SessionPayload } from './session.types';

// ---------------------------------------------------------------------------
// Test guard — reads x-test-user-id header; throws 401 when absent
// ---------------------------------------------------------------------------

class TestJwtGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const userId = req.headers['x-test-user-id'] as string | undefined;
    if (!userId) throw new UnauthorizedException('not authenticated');
    req.session = { userId, role: 'USER', firmId: null } as SessionPayload;
    return true;
  }
}

// ---------------------------------------------------------------------------
// Fixture data
// ---------------------------------------------------------------------------

function makeUser(overrides: Partial<Record<string, unknown>> = {}): User {
  return {
    id: 'user-1',
    email: 'user@demo.local',
    passwordHash: 'hash',
    password_hash: null,
    name: 'Demo User',
    display_name: null,
    role: 'USER',
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

const USER_IDENTITY = {
  id: 'user-1',
  email: 'user@demo.local',
  name: 'Demo User',
  displayName: 'Demo User',
  role: 'USER',
  organizationId: 'org-1',
  active: true,
};

// ---------------------------------------------------------------------------
// Module setup
// ---------------------------------------------------------------------------

describe('Identity HTTP endpoints (auth-identity.http.spec)', () => {
  let app: INestApplication;

  const mockAuthService = {
    login: jest.fn(),
    getCurrentUser: jest.fn(),
    updateProfile: jest.fn(),
    issueToken: jest.fn().mockResolvedValue('test-token'),
  };

  const mockUsersService = {
    findById: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController, UsersController],
      providers: [
        { provide: AuthService, useValue: mockAuthService },
        { provide: UsersService, useValue: mockUsersService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(TestJwtGuard)
      .compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.resetAllMocks();
    mockAuthService.issueToken.mockResolvedValue('test-token');
  });

  // -------------------------------------------------------------------------
  // POST /api/auth/login
  // -------------------------------------------------------------------------

  describe('POST /api/auth/login', () => {
    it('returns 200 with USER identity when login succeeds', async () => {
      const user = makeUser({ email: 'user@demo.local', role: 'USER', name: 'Demo User', organization_id: 'org-1', active: true });
      mockAuthService.login.mockResolvedValue({ user, token: 'tok' });

      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'user@demo.local', password: 'pass1234' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: 'user-1',
        email: 'user@demo.local',
        role: 'USER',
        organizationId: 'org-1',
        active: true,
      });
      expect(res.body).toHaveProperty('displayName');
    });

    it('returns 200 with MANAGER role', async () => {
      const user = makeUser({ email: 'manager@demo.local', role: 'MANAGER', name: 'Manager User', organization_id: 'org-1', active: true });
      mockAuthService.login.mockResolvedValue({ user, token: 'tok' });

      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'manager@demo.local', password: 'pass1234' });

      expect(res.status).toBe(200);
      expect(res.body.role).toBe('MANAGER');
      expect(res.body.active).toBe(true);
    });

    it('returns 200 with ADMIN role', async () => {
      const user = makeUser({ email: 'admin@demo.local', role: 'ADMIN', name: 'Admin User', organization_id: 'org-1', active: true });
      mockAuthService.login.mockResolvedValue({ user, token: 'tok' });

      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'admin@demo.local', password: 'pass1234' });

      expect(res.status).toBe(200);
      expect(res.body.role).toBe('ADMIN');
      expect(res.body.active).toBe(true);
    });

    it('returns 401 for an inactive account', async () => {
      mockAuthService.login.mockRejectedValue(new UnauthorizedException('invalid credentials'));

      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'inactive@demo.local', password: 'pass1234' });

      expect(res.status).toBe(401);
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/auth/me
  // -------------------------------------------------------------------------

  describe('GET /api/auth/me', () => {
    it('returns 200 with identity for an authenticated active user', async () => {
      const user = makeUser();
      mockAuthService.getCurrentUser.mockResolvedValue(user);

      const res = await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('x-test-user-id', 'user-1');

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject(USER_IDENTITY);
    });

    it('returns 401 when getCurrentUser throws (inactive account)', async () => {
      mockAuthService.getCurrentUser.mockRejectedValue(new UnauthorizedException('invalid credentials'));

      const res = await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('x-test-user-id', 'inactive-user');

      expect(res.status).toBe(401);
    });

    it('returns 401 with no session (no x-test-user-id header)', async () => {
      const res = await request(app.getHttpServer()).get('/api/auth/me');
      expect(res.status).toBe(401);
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/users/me
  // -------------------------------------------------------------------------

  describe('GET /api/users/me', () => {
    it('returns 200 with identity for an authenticated active user', async () => {
      const user = makeUser();
      mockUsersService.findById.mockResolvedValue(user);

      const res = await request(app.getHttpServer())
        .get('/api/users/me')
        .set('x-test-user-id', 'user-1');

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject(USER_IDENTITY);
    });

    it('returns 401 for an inactive account', async () => {
      const inactiveUser = makeUser({ active: false });
      mockUsersService.findById.mockResolvedValue(inactiveUser);

      const res = await request(app.getHttpServer())
        .get('/api/users/me')
        .set('x-test-user-id', 'inactive-user');

      expect(res.status).toBe(401);
    });

    it('returns 401 with no session (no x-test-user-id header)', async () => {
      const res = await request(app.getHttpServer()).get('/api/users/me');
      expect(res.status).toBe(401);
    });
  });
});
