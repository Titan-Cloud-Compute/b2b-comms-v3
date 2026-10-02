/**
 * HTTP integration tests for the identity endpoints.
 *
 * Mounts AuthController and UsersController in an isolated NestJS test
 * application with:
 *  - AuthService and UsersService replaced by jest mocks.
 *  - JwtAuthGuard overridden by a test guard that reads the `x-test-user-id`
 *    header and, when present, injects req.session so controllers see an
 *    authenticated session; when absent it throws 401 just like the real guard.
 *
 * Asserts:
 *  - POST /api/auth/login returns {id,email,name,displayName,role,organizationId,active}
 *    for USER / MANAGER / ADMIN accounts, including inactive → 401.
 *  - GET /api/auth/me returns identity; inactive → 401; no session → 401.
 *  - GET /api/users/me returns identity; inactive → 401; no session → 401.
 */

import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { UsersController } from '../users/users.controller';
import { UsersService } from '../users/users.service';
import type { User } from '@prisma/client';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeUser(
  role: 'USER' | 'MANAGER' | 'ADMIN',
  overrides: Partial<User> = {},
): User {
  const email = `${role.toLowerCase()}@demo.local`;
  return {
    id: `uid-${role.toLowerCase()}`,
    email,
    name: `${role} User`,
    passwordHash: 'hashed',
    role: role as any,
    defaultLlmModelId: null,
    grantedModelIds: [],
    quotaResetAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    password_hash: null,
    display_name: `${role} Display`,
    organization_id: 'org-1',
    active: true,
    created_at: null,
    ...overrides,
  } as unknown as User;
}

const USERS = {
  user: makeUser('USER'),
  manager: makeUser('MANAGER'),
  admin: makeUser('ADMIN'),
  inactive: makeUser('USER', {
    id: 'uid-inactive',
    email: 'inactive@demo.local',
    active: false,
  } as Partial<User>),
};

// ---------------------------------------------------------------------------
// Test-only JWT guard — sets req.session from header; throws 401 when absent
// ---------------------------------------------------------------------------

class TestJwtGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const userId = req.headers['x-test-user-id'] as string | undefined;
    if (!userId) {
      throw new UnauthorizedException('not authenticated');
    }
    req.session = { userId, role: 'USER', firmId: null };
    return true;
  }
}

// ---------------------------------------------------------------------------
// App factory
// ---------------------------------------------------------------------------

async function buildApp(
  authServiceMock: Partial<AuthService>,
  usersServiceMock: Partial<UsersService>,
): Promise<INestApplication> {
  const moduleRef: TestingModule = await Test.createTestingModule({
    controllers: [AuthController, UsersController],
    providers: [
      { provide: AuthService, useValue: authServiceMock },
      { provide: UsersService, useValue: usersServiceMock },
    ],
  })
    .overrideGuard(JwtAuthGuard)
    .useClass(TestJwtGuard)
    .compile();

  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}

// ---------------------------------------------------------------------------
// POST /api/auth/login
// ---------------------------------------------------------------------------

describe('POST /api/auth/login', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const authMock: Partial<AuthService> = {
      login: jest.fn().mockImplementation(({ email }: { email: string }) => {
        const user = Object.values(USERS).find((u) => u.email === email);
        if (!user) throw new UnauthorizedException('invalid credentials');
        if (!user.active) throw new UnauthorizedException('invalid credentials');
        return Promise.resolve({ user, token: 'tok' });
      }),
    };
    app = await buildApp(authMock, {});
  });

  afterAll(() => app.close());

  it.each([
    ['USER', 'user@demo.local', 'USER'],
    ['MANAGER', 'manager@demo.local', 'MANAGER'],
    ['ADMIN', 'admin@demo.local', 'ADMIN'],
  ])('%s account returns 200 with full identity', async (_label, email, role) => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: 'password123' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      email,
      role,
      organizationId: 'org-1',
      active: true,
    });
    expect(res.body).toHaveProperty('id');
    expect(res.body).toHaveProperty('name');
    expect(res.body).toHaveProperty('displayName');
  });

  it('inactive account returns 401', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'inactive@demo.local', password: 'password123' });

    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// GET /api/auth/me
// ---------------------------------------------------------------------------

describe('GET /api/auth/me', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const authMock: Partial<AuthService> = {
      getCurrentUser: jest.fn().mockImplementation((userId: string) => {
        const user = Object.values(USERS).find((u) => u.id === userId);
        if (!user) throw new UnauthorizedException('invalid credentials');
        if (!user.active) throw new UnauthorizedException('invalid credentials');
        return Promise.resolve(user);
      }),
    };
    app = await buildApp(authMock, {});
  });

  afterAll(() => app.close());

  it('returns identity for an active user', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('x-test-user-id', USERS.user.id);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: USERS.user.id,
      email: USERS.user.email,
      role: 'USER',
      organizationId: 'org-1',
      active: true,
    });
    expect(res.body).toHaveProperty('name');
    expect(res.body).toHaveProperty('displayName');
  });

  it('returns 401 for an inactive user', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('x-test-user-id', USERS.inactive.id);

    expect(res.status).toBe(401);
  });

  it('returns 401 with no session', async () => {
    const res = await request(app.getHttpServer()).get('/api/auth/me');

    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// GET /api/users/me
// ---------------------------------------------------------------------------

describe('GET /api/users/me', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const usersMock: Partial<UsersService> = {
      findById: jest.fn().mockImplementation((id: string) => {
        const user = Object.values(USERS).find((u) => u.id === id);
        return Promise.resolve(user ?? null);
      }),
    };
    app = await buildApp({}, usersMock);
  });

  afterAll(() => app.close());

  it('returns identity for an active user', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/users/me')
      .set('x-test-user-id', USERS.user.id);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: USERS.user.id,
      email: USERS.user.email,
      role: 'USER',
      organizationId: 'org-1',
      active: true,
    });
    expect(res.body).toHaveProperty('name');
    expect(res.body).toHaveProperty('displayName');
  });

  it('returns 401 for an inactive user', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/users/me')
      .set('x-test-user-id', USERS.inactive.id);

    expect(res.status).toBe(401);
  });

  it('returns 401 with no session', async () => {
    const res = await request(app.getHttpServer()).get('/api/users/me');

    expect(res.status).toBe(401);
  });
});
