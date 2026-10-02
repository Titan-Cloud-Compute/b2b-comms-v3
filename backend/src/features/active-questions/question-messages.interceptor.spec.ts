import 'reflect-metadata';
import { Controller, HttpCode, INestApplication, Post } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request = require('supertest');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const cookieParser = require('cookie-parser');
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { QuestionMessagesInterceptor } from './question-messages.interceptor';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ── Stub controller ────────────────────────────────────────────────────────

let stubCalled = false;

@Controller('api/channels/:id/messages')
class StubMessagesController {
  @Post()
  @HttpCode(201)
  postMessage() {
    stubCalled = true;
    return { id: 'm-1' };
  }
}

// ── In-memory Prisma fake ───────────────────────────────────────────────────

function makeFakePrisma(channelOverride?: Partial<{ kind: string; status: string }>) {
  const defaultChannel = { id: 'ch-q', kind: 'question', status: 'open', ...channelOverride };
  const resolutions: any[] = [
    { channel_id: 'ch-q', side: 'internal', resolved_by: 'u1', resolved_at: new Date() },
  ];

  const db: any = {
    channels: {
      findUnique: async ({ where }: any) => {
        if (where.id !== 'ch-q') return null;
        // Return only selected fields if select is specified
        const { select } = arguments[0] ?? {};
        if (select) {
          const result: any = {};
          if (select.kind) result.kind = defaultChannel.kind;
          if (select.status) result.status = defaultChannel.status;
          return result;
        }
        return defaultChannel;
      },
    },
    question_resolutions: {
      deleteMany: async ({ where }: any) => {
        const before = resolutions.length;
        const toKeep = resolutions.filter((r) => r.channel_id !== where.channel_id);
        resolutions.splice(0, resolutions.length, ...toKeep);
        return { count: before - toKeep.length };
      },
    },
  };

  return { db, resolutions };
}

// ── Test suite ──────────────────────────────────────────────────────────────

describe('QuestionMessagesInterceptor (real JwtAuthGuard)', () => {
  let app: INestApplication;
  let jwtService: JwtService;
  let fake: ReturnType<typeof makeFakePrisma>;

  const session = { userId: 'u1', role: 'USER', firmId: null, organizationId: 'org-1' };

  async function buildApp(channelOverride?: Partial<{ kind: string; status: string }>) {
    fake = makeFakePrisma(channelOverride);
    // findUnique needs to see the select argument — patch it properly
    const origFind = fake.db.channels.findUnique.bind(fake.db.channels);
    fake.db.channels.findUnique = async (args: any) => {
      const ch = channelOverride
        ? { id: 'ch-q', kind: 'question', status: 'open', ...channelOverride }
        : { id: 'ch-q', kind: 'question', status: 'open' };
      if (args?.where?.id !== 'ch-q') return null;
      if (args?.select) {
        const result: any = {};
        if (args.select.kind) result.kind = ch.kind;
        if (args.select.status) result.status = ch.status;
        return result;
      }
      return ch;
    };
    void origFind; // suppress unused warning

    const mod = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: 'test' })],
      controllers: [StubMessagesController],
      providers: [
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_INTERCEPTOR, useClass: QuestionMessagesInterceptor },
        { provide: PrismaService, useValue: fake.db },
      ],
    }).compile();

    app = mod.createNestApplication();
    app.use(cookieParser());
    await app.init();
    jwtService = mod.get(JwtService);
  }

  beforeEach(() => {
    stubCalled = false;
  });

  afterEach(async () => {
    await app?.close();
  });

  function authCookie() {
    return `session=${jwtService.sign(session)}`;
  }

  // ── Case 1: unauthenticated returns 401 ────────────────────────────────────

  it('returns 401 for unauthenticated POST', async () => {
    await buildApp();
    const res = await request(app.getHttpServer())
      .post('/api/channels/ch-q/messages')
      .send({});
    expect(res.status).toBe(401);
    expect(stubCalled).toBe(false);
  });

  // ── Case 2: resolved question returns 403 without hitting the handler ──────

  it('returns 403 when channel status is resolved, handler never runs', async () => {
    await buildApp({ status: 'resolved' });
    const res = await request(app.getHttpServer())
      .post('/api/channels/ch-q/messages')
      .set('Cookie', authCookie())
      .send({});
    expect(res.status).toBe(403);
    expect(stubCalled).toBe(false);
  });

  // ── Case 3: open question with marks → handler runs, marks are deleted ─────

  it('clears resolution rows after successful post to open question with marks', async () => {
    await buildApp(); // ch-q is open, has one resolution row
    expect(fake.resolutions).toHaveLength(1);

    const res = await request(app.getHttpServer())
      .post('/api/channels/ch-q/messages')
      .set('Cookie', authCookie())
      .send({});
    expect(res.status).toBe(201);
    expect(stubCalled).toBe(true);
    expect(fake.resolutions).toHaveLength(0);
    // Channel status must still be 'open' (interceptor never touches channels.status)
  });

  // ── Case 4: non-question channel passes through untouched ──────────────────

  it('passes through POST to a non-question channel without touching resolutions', async () => {
    await buildApp({ kind: 'general' }); // channel exists but kind is not 'question'
    const resBefore = fake.resolutions.length;

    const res = await request(app.getHttpServer())
      .post('/api/channels/ch-q/messages')
      .set('Cookie', authCookie())
      .send({});
    // Handler should run (stub returns 201)
    expect(res.status).toBe(201);
    expect(stubCalled).toBe(true);
    // Resolution rows must not be touched
    expect(fake.resolutions).toHaveLength(resBefore);
  });
});
