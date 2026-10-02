/**
 * HTTP-level check: POST /api/auth/login, GET /api/auth/me and GET /api/users/me
 * return the REAL signed-in identity (role + organizationId) from the users
 * table, and the session cookie gates /me. No database: Prisma is mocked.
 */
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import * as request from 'supertest';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { MailerService } from './mailer.service';
import { PrismaService } from '../prisma/prisma.service';
import { AppConfigService } from '../config/config.service';
import { UsersController } from '../users/users.controller';
import { UsersService } from '../users/users.service';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const cookieParser = require('cookie-parser');

type Row = Record<string, unknown>;

describe('auth identity over HTTP', () => {
  let app: INestApplication;
  const rows: Row[] = [];
  const find = (where: { id?: string; email?: string }) =>
    rows.find((r) => (where.id ? r.id === where.id : r.email === where.email)) ?? null;

  beforeAll(async () => {
    const hash = await bcrypt.hash('secret-pass', 4);
    rows.push(
      {
        id: 'u-admin', email: 'admin@demo.local', passwordHash: hash, name: null,
        display_name: 'Admin', role: 'ADMIN', organization_id: 'org-int', active: true,
      },
      {
        id: 'u-mgr', email: 'manager@demo.local', passwordHash: hash, name: null,
        display_name: 'Manager', role: 'MANAGER', organization_id: 'org-int', active: true,
      },
      {
        id: 'u-user', email: 'user@demo.local', passwordHash: hash, name: null,
        display_name: 'User', role: 'USER', organization_id: 'org-ext', active: true,
      },
      {
        id: 'u-off', email: 'off@demo.local', passwordHash: hash, name: null,
        display_name: 'Off', role: 'USER', organization_id: 'org-ext', active: false,
      },
    );
    const tx = {
      user: {
        findUnique: jest.fn(async ({ where }: { where: { id?: string; email?: string } }) => find(where)),
      },
    };
    const prisma = {
      runAsAdmin: (fn: (t: typeof tx) => unknown) => fn(tx),
      user: tx.user,
    };

    const moduleRef = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: 'test-secret', signOptions: { expiresIn: 3600 } })],
      controllers: [AuthController, UsersController],
      providers: [
        AuthService,
        UsersService,
        JwtAuthGuard,
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: PrismaService, useValue: prisma },
        { provide: AppConfigService, useValue: {} },
        { provide: MailerService, useValue: {} },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  async function signIn(email: string) {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: 'secret-pass' });
    const raw = res.headers['set-cookie'] as unknown as string[] | string | undefined;
    const cookies = Array.isArray(raw) ? raw : raw ? [raw] : [];
    return { res, cookie: cookies.map((c) => c.split(';')[0]).join('; ') };
  }

  it.each([
    ['user@demo.local', 'USER', 'org-ext'],
    ['manager@demo.local', 'MANAGER', 'org-int'],
    ['admin@demo.local', 'ADMIN', 'org-int'],
  ])('%s gets its real role and organization from login, auth/me and users/me', async (email, role, org) => {
    const { res, cookie } = await signIn(email);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ email, role, organizationId: org });
    expect(cookie).toContain('session=');

    const me = await request(app.getHttpServer()).get('/api/auth/me').set('Cookie', cookie);
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ email, role, organizationId: org });

    const usersMe = await request(app.getHttpServer()).get('/api/users/me').set('Cookie', cookie);
    expect(usersMe.status).toBe(200);
    expect(usersMe.body).toMatchObject({ email, role, organizationId: org });
  });

  it('refuses a deactivated user', async () => {
    const { res, cookie } = await signIn('off@demo.local');
    expect(res.status).toBe(401);
    expect(cookie).toBe('');
  });

  it('returns 401 from /me without a session', async () => {
    await request(app.getHttpServer()).get('/api/auth/me').expect(401);
    await request(app.getHttpServer()).get('/api/users/me').expect(401);
  });
});
