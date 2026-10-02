import 'reflect-metadata';
import { type INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request = require('supertest');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const cookieParser = require('cookie-parser');
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { ActiveQuestionsService } from './active-questions.service';
import {
  ProjectQuestionsController,
  QuestionsController,
} from './active-questions.controller';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ── In-memory Prisma fake ───────────────────────────────────────────────────

function makeFakePrisma() {
  const users: any[] = [
    { id: 'int-member', organization_id: 'org-int' },
    { id: 'ext-member', organization_id: 'org-ext' },
    { id: 'non-member', organization_id: 'org-int' },
  ];
  const organizations: any[] = [
    { id: 'org-int', is_internal: true },
    { id: 'org-ext', is_internal: false },
  ];
  const projects: any[] = [
    { id: 'p0', name: 'Test Project', status: 'active', created_by: 'int-member' },
  ];
  const members: any[] = [
    { project_id: 'p0', user_id: 'int-member' },
    { project_id: 'p0', user_id: 'ext-member' },
  ];
  const channels: any[] = [];
  const resolutions: any[] = [];
  const messages: any[] = [];

  let seq = 0;
  const nextId = (prefix: string) => `${prefix}-${++seq}`;

  const db: any = {
    user: {
      findUnique: async ({ where, include }: any) => {
        const u = users.find((x) => x.id === where.id);
        if (!u) return null;
        if (!include?.organization) return u;
        const org = organizations.find((o) => o.id === u.organization_id) ?? null;
        return { ...u, organization: org };
      },
    },
    organizations: {
      findUnique: async ({ where }: any) =>
        organizations.find((o) => o.id === where.id) ?? null,
    },
    projects: {
      findUnique: async ({ where }: any) =>
        projects.find((p) => p.id === where.id) ?? null,
    },
    project_members: {
      findUnique: async ({ where }: any) => {
        const { project_id, user_id } = where.project_id_user_id;
        return members.find(
          (m) => m.project_id === project_id && m.user_id === user_id,
        ) ?? null;
      },
    },
    channels: {
      findMany: async ({ where, orderBy }: any) => {
        let result = channels.filter((c) => {
          if (where.project_id && c.project_id !== where.project_id) return false;
          if (where.kind && c.kind !== where.kind) return false;
          return true;
        });
        if (orderBy?.created_at === 'desc') {
          result = [...result].sort(
            (a, b) =>
              new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
          );
        }
        return result;
      },
      findUnique: async ({ where }: any) =>
        channels.find((c) => c.id === where.id) ?? null,
      create: async ({ data }: any) => {
        const row = { id: nextId('ch'), created_at: new Date(), ...data };
        channels.push(row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const c = channels.find((x) => x.id === where.id);
        if (!c) throw new Error('channel not found');
        Object.assign(c, data);
        return c;
      },
    },
    question_resolutions: {
      findMany: async ({ where }: any) =>
        resolutions.filter((r) => r.channel_id === where.channel_id),
      upsert: async ({ where, create, update }: any) => {
        const { channel_id, side } = where.channel_id_side;
        const existing = resolutions.find(
          (r) => r.channel_id === channel_id && r.side === side,
        );
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const row = { ...create, resolved_at: new Date() };
        resolutions.push(row);
        return row;
      },
      deleteMany: async ({ where }: any) => {
        const before = resolutions.length;
        const toKeep = resolutions.filter(
          (r) => !(r.channel_id === where.channel_id && r.side === where.side),
        );
        resolutions.splice(0, resolutions.length, ...toKeep);
        return { count: before - toKeep.length };
      },
    },
    messages: {
      create: async ({ data }: any) => {
        const row = { id: nextId('msg'), created_at: new Date(), ...data };
        messages.push(row);
        return row;
      },
    },
    $transaction: async (fn: any) => fn(db),
  };

  return { db, channels, resolutions, messages };
}

// ── Session payloads ────────────────────────────────────────────────────────

const sessions = {
  intMember: { userId: 'int-member', role: 'USER', firmId: null, organizationId: 'org-int' },
  extMember: { userId: 'ext-member', role: 'USER', firmId: null, organizationId: 'org-ext' },
  nonMember: { userId: 'non-member', role: 'USER', firmId: null, organizationId: 'org-int' },
};

// ── Test suite ──────────────────────────────────────────────────────────────

describe('Active Questions HTTP (real JwtAuthGuard)', () => {
  let app: INestApplication;
  let fake: ReturnType<typeof makeFakePrisma>;
  let jwtService: JwtService;

  beforeEach(async () => {
    fake = makeFakePrisma();

    const mod = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: 'test' })],
      controllers: [ProjectQuestionsController, QuestionsController],
      providers: [
        ActiveQuestionsService,
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: PrismaService, useValue: fake.db },
      ],
    }).compile();

    app = mod.createNestApplication();
    app.use(cookieParser());
    await app.init();
    jwtService = mod.get(JwtService);
  });

  afterEach(async () => {
    await app.close();
  });

  /** Send an authenticated request as the given session payload. */
  function as(session: object) {
    const token = jwtService.sign(session);
    const cookie = `session=${token}`;
    return {
      get: (url: string) =>
        request(app.getHttpServer()).get(url).set('Cookie', cookie),
      post: (url: string, body?: any) =>
        request(app.getHttpServer())
          .post(url)
          .set('Cookie', cookie)
          .send(body ?? {}),
      delete: (url: string) =>
        request(app.getHttpServer()).delete(url).set('Cookie', cookie),
    };
  }

  // ── Auth / membership ─────────────────────────────────────────────────────

  it('returns 401 for unauthenticated requests', async () => {
    expect(
      (await request(app.getHttpServer()).get('/api/projects/p0/questions')).status,
    ).toBe(401);
    expect(
      (await request(app.getHttpServer()).post('/api/projects/p0/questions').send({}))
        .status,
    ).toBe(401);
  });

  it('returns 403 for non-members', async () => {
    const getRes = await as(sessions.nonMember).get('/api/projects/p0/questions');
    expect(getRes.status).toBe(403);

    const postRes = await as(sessions.nonMember).post('/api/projects/p0/questions', {
      title: 'Should fail',
      body_html: '<p>text</p>',
    });
    expect(postRes.status).toBe(403);
  });

  // ── Create question ───────────────────────────────────────────────────────

  it('creates a question with 201 and writes one channels row + one messages row', async () => {
    const res = await as(sessions.intMember).post('/api/projects/p0/questions', {
      title: 'Test Question',
      body_html: '<p>First message</p>',
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      projectId: 'p0',
      title: 'Test Question',
      status: 'open',
      resolvedSides: [],
      mySide: 'internal',
    });
    expect(typeof res.body.id).toBe('string');

    expect(fake.channels).toHaveLength(1);
    expect(fake.channels[0]).toMatchObject({ kind: 'question', status: 'open' });
    expect(fake.messages).toHaveLength(1);
    expect(fake.messages[0].body_html).toBe('<p>First message</p>');
  });

  it('returns 400 for blank title and writes no rows', async () => {
    const res = await as(sessions.intMember).post('/api/projects/p0/questions', {
      title: '   ',
      body_html: '<p>Content</p>',
    });
    expect(res.status).toBe(400);
    expect(fake.channels).toHaveLength(0);
    expect(fake.messages).toHaveLength(0);
  });

  it('returns 400 for blank body_html (only whitespace / tags) and writes no rows', async () => {
    const res = await as(sessions.intMember).post('/api/projects/p0/questions', {
      title: 'Valid Title',
      body_html: '  <p>  </p>  ',
    });
    expect(res.status).toBe(400);
    expect(fake.channels).toHaveLength(0);
    expect(fake.messages).toHaveLength(0);
  });

  // ── Resolve / withdraw ────────────────────────────────────────────────────

  async function createQuestion(): Promise<string> {
    const res = await as(sessions.intMember).post('/api/projects/p0/questions', {
      title: 'Q',
      body_html: 'text',
    });
    expect(res.status).toBe(201);
    return res.body.id as string;
  }

  it('first side resolve returns 200 status "open" with one question_resolutions row', async () => {
    const qId = await createQuestion();

    const res = await as(sessions.intMember).post(`/api/questions/${qId}/resolve`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('open');
    expect(fake.resolutions).toHaveLength(1);
    expect(fake.resolutions[0].side).toBe('internal');
  });

  it('second side resolve returns 200 status "resolved" and sets channels.status "resolved"', async () => {
    const qId = await createQuestion();

    await as(sessions.intMember).post(`/api/questions/${qId}/resolve`);
    const res = await as(sessions.extMember).post(`/api/questions/${qId}/resolve`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('resolved');
    expect(fake.channels[0].status).toBe('resolved');
    expect(fake.resolutions).toHaveLength(2);
  });

  it('DELETE resolve returns 200 status "open" and deletes that side\'s row', async () => {
    const qId = await createQuestion();

    await as(sessions.intMember).post(`/api/questions/${qId}/resolve`);
    expect(fake.resolutions).toHaveLength(1);

    const res = await as(sessions.intMember).delete(`/api/questions/${qId}/resolve`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('open');
    expect(fake.resolutions).toHaveLength(0);
  });
});
