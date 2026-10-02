import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { JwtModule, JwtService } from '@nestjs/jwt';
import * as cookieParser from 'cookie-parser';
import request = require('supertest');
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { ProjectQuestionsController, QuestionsController } from './active-questions.controller';
import { ActiveQuestionsService } from './active-questions.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

type Row = Record<string, any>;

function makeFakePrisma() {
  const users: Row[] = [
    { id: 'int-member', email: 'int@x', display_name: 'Int', organization_id: 'org-int' },
    { id: 'ext-member', email: 'ext@x', display_name: 'Ext', organization_id: 'org-ext' },
    { id: 'non-member', email: 'non@x', display_name: 'Non', organization_id: 'org-int' },
  ];
  const organizations: Row[] = [
    { id: 'org-int', name: 'Us', type: 'internal', is_internal: true },
    { id: 'org-ext', name: 'Them', type: 'vendor', is_internal: false },
  ];
  const projects: Row[] = [
    { id: 'p1', organization_id: 'org-ext', name: 'Project 1', status: 'active', created_by: 'int-member' },
  ];
  const project_members: Row[] = [
    { project_id: 'p1', user_id: 'int-member' },
    { project_id: 'p1', user_id: 'ext-member' },
  ];
  const channels: Row[] = [];
  const question_resolutions: Row[] = [];
  const messages: Row[] = [];

  let seq = 0;
  const nextId = (p: string) => `${p}-${++seq}`;
  const now = () => new Date(Date.UTC(2026, 0, 1, 0, 0, ++seq));

  const db: any = {
    user: {
      findUnique: async ({ where }: any) => {
        const u = users.find((x) => x.id === where.id) ?? null;
        return u ? { ...u } : null;
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
        return (
          project_members.find(
            (m) => m.project_id === project_id && m.user_id === user_id,
          ) ?? null
        );
      },
    },
    channels: {
      findUnique: async ({ where }: any) =>
        channels.find((c) => c.id === where.id) ?? null,
      findMany: async ({ where, orderBy }: any) => {
        let result = channels.filter((c) => {
          if (where.project_id && c.project_id !== where.project_id) return false;
          if (where.kind && c.kind !== where.kind) return false;
          return true;
        });
        if (orderBy?.created_at === 'desc') result = [...result].reverse();
        return result;
      },
      create: async ({ data }: any) => {
        const row: Row = { id: nextId('ch'), created_at: now(), ...data };
        channels.push(row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const ch = channels.find((c) => c.id === where.id)!;
        Object.assign(ch, data);
        return ch;
      },
    },
    question_resolutions: {
      findMany: async ({ where }: any) =>
        question_resolutions.filter((r) => r.channel_id === where.channel_id),
      upsert: async ({ where, create, update }: any) => {
        const { channel_id, side } = where.channel_id_side;
        const idx = question_resolutions.findIndex(
          (r) => r.channel_id === channel_id && r.side === side,
        );
        if (idx >= 0) {
          Object.assign(question_resolutions[idx], update);
          return question_resolutions[idx];
        }
        const row: Row = { ...create, resolved_at: now() };
        question_resolutions.push(row);
        return row;
      },
      deleteMany: async ({ where }: any) => {
        const before = question_resolutions.length;
        const keep = question_resolutions.filter(
          (r) => !(r.channel_id === where.channel_id && r.side === where.side),
        );
        question_resolutions.splice(0, question_resolutions.length, ...keep);
        return { count: before - question_resolutions.length };
      },
    },
    messages: {
      create: async ({ data }: any) => {
        const row: Row = { id: nextId('msg'), created_at: now(), ...data };
        messages.push(row);
        return row;
      },
    },
    $transaction: async (fn: any) => fn(db),
  };

  return { db, channels, question_resolutions, messages };
}

/** Sessions for our three test users. */
const SESSION = {
  internalMember: { userId: 'int-member', role: 'USER', firmId: null, organizationId: 'org-int' },
  externalMember: { userId: 'ext-member', role: 'USER', firmId: null, organizationId: 'org-ext' },
  nonMember: { userId: 'non-member', role: 'USER', firmId: null, organizationId: 'org-int' },
};

describe('Active Questions HTTP', () => {
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
        JwtAuthGuard,
        { provide: APP_GUARD, useClass: JwtAuthGuard },
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

  function as(session: any) {
    return {
      get: async (url: string) => {
        const c = await cookieFor(session);
        return request(app.getHttpServer()).get(url).set('Cookie', c);
      },
      post: async (url: string, body?: any) => {
        const c = await cookieFor(session);
        return request(app.getHttpServer()).post(url).set('Cookie', c).send(body ?? {});
      },
      delete: async (url: string) => {
        const c = await cookieFor(session);
        return request(app.getHttpServer()).delete(url).set('Cookie', c);
      },
    };
  }

  // ─── Auth / membership guards ─────────────────────────────────────────────

  it('GET /api/projects/:id/questions returns 401 when unauthenticated', async () => {
    const res = await request(app.getHttpServer()).get('/api/projects/p1/questions');
    expect(res.status).toBe(401);
  });

  it('POST /api/projects/:id/questions returns 401 when unauthenticated', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/projects/p1/questions')
      .send({ title: 'Q', body_html: '<p>msg</p>' });
    expect(res.status).toBe(401);
  });

  it('GET /api/projects/:id/questions returns 403 for non-members', async () => {
    const res = await as(SESSION.nonMember).get('/api/projects/p1/questions');
    expect(res.status).toBe(403);
  });

  it('POST /api/projects/:id/questions returns 403 for non-members', async () => {
    const res = await as(SESSION.nonMember).post('/api/projects/p1/questions', {
      title: 'Q',
      body_html: '<p>msg</p>',
    });
    expect(res.status).toBe(403);
    expect(fake.channels).toHaveLength(0);
  });

  // ─── Create question ──────────────────────────────────────────────────────

  it('POST with valid title and message returns 201 and writes one channel + one message', async () => {
    const res = await as(SESSION.internalMember).post('/api/projects/p1/questions', {
      title: 'How does billing work?',
      body_html: '<p>Please explain the billing cycle.</p>',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      projectId: 'p1',
      title: 'How does billing work?',
      status: 'open',
      resolvedSides: [],
      mySide: 'internal',
    });
    expect(fake.channels).toHaveLength(1);
    expect(fake.channels[0]).toMatchObject({ kind: 'question', status: 'open', name: 'How does billing work?' });
    expect(fake.messages).toHaveLength(1);
    expect(fake.messages[0].body_html).toBe('<p>Please explain the billing cycle.</p>');
  });

  it('POST with blank title returns 400 and writes no channel', async () => {
    const res = await as(SESSION.internalMember).post('/api/projects/p1/questions', {
      title: '   ',
      body_html: '<p>hello</p>',
    });
    expect(res.status).toBe(400);
    expect(fake.channels).toHaveLength(0);
  });

  it('POST with blank body_html (HTML-only) returns 400 and writes no channel', async () => {
    const res = await as(SESSION.internalMember).post('/api/projects/p1/questions', {
      title: 'A real title',
      body_html: '<p>&nbsp;</p>',
    });
    expect(res.status).toBe(400);
    expect(fake.channels).toHaveLength(0);
  });

  it('POST with missing body_html returns 400 and writes no channel', async () => {
    const res = await as(SESSION.internalMember).post('/api/projects/p1/questions', {
      title: 'A title',
    });
    expect(res.status).toBe(400);
    expect(fake.channels).toHaveLength(0);
  });

  // ─── Resolve / withdraw ───────────────────────────────────────────────────

  async function createQuestion(): Promise<string> {
    const res = await as(SESSION.internalMember).post('/api/projects/p1/questions', {
      title: 'Billing?',
      body_html: '<p>Explain billing.</p>',
    });
    expect(res.status).toBe(201);
    return res.body.id as string;
  }

  it('first side resolve returns 200 with status open and one question_resolutions row', async () => {
    const qId = await createQuestion();
    const res = await as(SESSION.internalMember).post(`/api/questions/${qId}/resolve`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('open');
    expect(fake.question_resolutions).toHaveLength(1);
    expect(fake.question_resolutions[0]).toMatchObject({ channel_id: qId, side: 'internal' });
  });

  it('second side resolve returns 200 with status resolved and channels.status updated', async () => {
    const qId = await createQuestion();
    // Internal marks resolved
    await as(SESSION.internalMember).post(`/api/questions/${qId}/resolve`);
    // External marks resolved
    const res = await as(SESSION.externalMember).post(`/api/questions/${qId}/resolve`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('resolved');
    expect(fake.channels[0].status).toBe('resolved');
    expect(fake.question_resolutions).toHaveLength(2);
  });

  it('DELETE resolve returns 200 with status open and removes that side row', async () => {
    const qId = await createQuestion();
    // Internal marks resolved
    await as(SESSION.internalMember).post(`/api/questions/${qId}/resolve`);
    expect(fake.question_resolutions).toHaveLength(1);
    // Internal withdraws
    const res = await as(SESSION.internalMember).delete(`/api/questions/${qId}/resolve`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('open');
    expect(fake.question_resolutions).toHaveLength(0);
  });
});
