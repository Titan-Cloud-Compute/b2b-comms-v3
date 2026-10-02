import 'reflect-metadata';
import { Controller, HttpCode, INestApplication, Post } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { JwtModule, JwtService } from '@nestjs/jwt';
import * as cookieParser from 'cookie-parser';
import request = require('supertest');
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { QuestionMessagesInterceptor } from './question-messages.interceptor';

/* eslint-disable @typescript-eslint/no-explicit-any */

type Row = Record<string, any>;

// ─── Stand-in handler ────────────────────────────────────────────────────────

let stubCalled = false;

@Controller('api/channels/:id/messages')
class StubMessagesController {
  @Post()
  @HttpCode(201)
  post() {
    stubCalled = true;
    return { id: 'm-1' };
  }
}

// ─── In-memory fake PrismaService ────────────────────────────────────────────

function makeFakePrisma() {
  const channels: Row[] = [];
  const question_resolutions: Row[] = [];

  const db: any = {
    channels: {
      findUnique: async ({ where }: any) =>
        channels.find((c) => c.id === where.id) ?? null,
      // ActiveQuestionsService needs these; they won't be called by these tests
      // but NestJS instantiates the service, so the shape must not throw.
      findMany: async () => [],
      create: async () => ({}),
      update: async () => ({}),
    },
    question_resolutions: {
      deleteMany: async ({ where }: any) => {
        const before = question_resolutions.length;
        // Delete every row that matches ALL provided where conditions.
        const keep = question_resolutions.filter((r) => {
          for (const [key, val] of Object.entries(where)) {
            if (r[key] !== val) return true; // at least one mismatch → keep
          }
          return false; // all match → delete
        });
        question_resolutions.splice(0, question_resolutions.length, ...keep);
        return { count: before - question_resolutions.length };
      },
      findMany: async ({ where }: any) =>
        question_resolutions.filter((r) => r.channel_id === where.channel_id),
      upsert: async () => ({}),
    },
    messages: {
      create: async ({ data }: any) => ({ id: 'msg-1', ...data }),
    },
    user: {
      findUnique: async () => null,
    },
    organizations: {
      findUnique: async () => null,
    },
    projects: {
      findUnique: async () => null,
    },
    project_members: {
      findUnique: async () => null,
    },
    $transaction: async (fn: any) => fn(db),
  };

  return { db, channels, question_resolutions };
}

// ─── Test user session ────────────────────────────────────────────────────────

const SESSION = {
  user: { userId: 'user-1', role: 'USER', firmId: null, organizationId: 'org-1' },
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('QuestionMessagesInterceptor', () => {
  let app: INestApplication;
  let fake: ReturnType<typeof makeFakePrisma>;
  let jwtService: JwtService;

  beforeEach(async () => {
    fake = makeFakePrisma();
    stubCalled = false;

    const mod = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: 'test' })],
      controllers: [StubMessagesController],
      providers: [
        JwtAuthGuard,
        QuestionMessagesInterceptor,
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_INTERCEPTOR, useClass: QuestionMessagesInterceptor },
        { provide: PrismaService, useValue: fake.db },
      ],
    }).compile();

    app = mod.createNestApplication();
    app.use(cookieParser());
    await app.init();

    jwtService = app.get(JwtService);
  });

  afterEach(async () => {
    await app.close();
  });

  async function cookieFor(session: any): Promise<string> {
    const token = await jwtService.signAsync(session);
    return `session=${token}`;
  }

  // 1. Unauthenticated POST → 401
  it('unauthenticated POST to a messages endpoint returns 401', async () => {
    fake.channels.push({ id: 'ch-q', kind: 'question', status: 'open' });
    const res = await request(app.getHttpServer())
      .post('/api/channels/ch-q/messages')
      .send({});
    expect(res.status).toBe(401);
    expect(stubCalled).toBe(false);
  });

  // 2. POST to resolved question → 403, handler never runs
  it('POST to a resolved question returns 403 and the handler is not invoked', async () => {
    fake.channels.push({ id: 'ch-resolved', kind: 'question', status: 'resolved' });
    const c = await cookieFor(SESSION.user);
    const res = await request(app.getHttpServer())
      .post('/api/channels/ch-resolved/messages')
      .set('Cookie', c)
      .send({});
    expect(res.status).toBe(403);
    expect(stubCalled).toBe(false);
  });

  // 3. POST to open question with one resolution mark → handler runs, resolutions cleared, status stays open
  it('POST to an open question clears question_resolutions and returns the handler response', async () => {
    fake.channels.push({ id: 'ch-open', kind: 'question', status: 'open' });
    fake.question_resolutions.push({
      channel_id: 'ch-open',
      side: 'internal',
      resolved_by: 'user-1',
    });

    const c = await cookieFor(SESSION.user);
    const res = await request(app.getHttpServer())
      .post('/api/channels/ch-open/messages')
      .set('Cookie', c)
      .send({});

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: 'm-1' });
    expect(stubCalled).toBe(true);
    // All resolution marks are deleted
    expect(fake.question_resolutions).toHaveLength(0);
    // Channel status is NOT modified by the interceptor
    expect(fake.channels[0].status).toBe('open');
  });

  // 4. POST to a non-question channel → passes through, no side effects
  it('POST to a non-question channel passes through to the handler untouched', async () => {
    fake.channels.push({ id: 'ch-general', kind: 'general', status: null });

    const c = await cookieFor(SESSION.user);
    const res = await request(app.getHttpServer())
      .post('/api/channels/ch-general/messages')
      .set('Cookie', c)
      .send({});

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: 'm-1' });
    expect(stubCalled).toBe(true);
    // No resolution rows were modified
    expect(fake.question_resolutions).toHaveLength(0);
  });
});
