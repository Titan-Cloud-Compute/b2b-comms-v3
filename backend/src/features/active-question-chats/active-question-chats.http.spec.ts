/**
 * Story: Active Question Chats — HTTP layer (real Nest app + supertest, in-memory DB).
 * Includes General Channels' message endpoint so the message-post hook is exercised.
 */
import { INestApplication } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request = require('supertest');
import { PrismaService } from '../../prisma/prisma.service';
import { GeneralChannelsController } from '../general-channels/general-channels.controller';
import { GeneralChannelsService } from '../general-channels/general-channels.service';
import { RealtimeHubService } from '../general-channels/realtime-hub.service';
import { ActiveQuestionChatsController } from './active-question-chats.controller';
import { ActiveQuestionChatsService } from './active-question-chats.service';
import { QuestionMessagesInterceptor } from './question-messages.interceptor';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([k, cond]) => {
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('in' in cond) return (cond.in as unknown[]).includes(row[k]);
      if ('lt' in cond) return row[k] != null && new Date(row[k]).getTime() < new Date(cond.lt).getTime();
    }
    if (cond === null) return row[k] == null;
    return row[k] === cond;
  });
}

class Table {
  rows: Row[] = [];
  private seq = 0;
  constructor(private readonly prefix: string) {}
  async findMany(args: { where?: Row; take?: number } = {}) {
    const all = this.rows.filter((r) => matches(r, args.where));
    return args.take ? all.slice(0, args.take) : all;
  }
  async findUnique(args: { where: Row }) {
    return this.rows.find((r) => matches(r, args.where)) ?? null;
  }
  async findFirst(args: { where?: Row } = {}) {
    return this.rows.find((r) => matches(r, args.where)) ?? null;
  }
  async create(args: { data: Row }) {
    const row = { id: `${this.prefix}${String(++this.seq).padStart(4, '0')}`, ...args.data };
    this.rows.push(row);
    return row;
  }
  async update(args: { where: Row; data: Row }) {
    const row = this.rows.find((r) => matches(r, args.where));
    if (!row) throw new Error('record not found');
    Object.assign(row, args.data);
    return row;
  }
  async deleteMany(args: { where?: Row } = {}) {
    const before = this.rows.length;
    this.rows = this.rows.filter((r) => !matches(r, args.where));
    return { count: before - this.rows.length };
  }
}

function makeDb() {
  const tx = {
    user: new Table('u'),
    organizations: new Table('org'),
    projects: new Table('p'),
    project_members: new Table('pm'),
    channels: new Table('ch'),
    messages: new Table('m'),
    message_attachments: new Table('ma'),
    files: new Table('f'),
    references: new Table('ref'),
    channel_read_state: new Table('crs'),
    question_resolutions: new Table('qr'),
  };
  tx.organizations.rows.push({ id: 'org-ext', name: 'Globex', is_internal: false });
  tx.user.rows.push(
    { id: 'manager', email: 'manager@x', name: 'Max', role: 'MANAGER', organizationId: null },
    { id: 'employee', email: 'emp@x', name: 'Eve', role: 'USER', organizationId: null },
    { id: 'external', email: 'ext@x', name: 'Xavier', role: 'USER', organizationId: 'org-ext' },
    { id: 'outsider', email: 'out@x', name: 'Olga', role: 'USER', organizationId: null },
  );
  tx.projects.rows.push({ id: 'p1', organization_id: 'org-ext', name: 'Globex', status: 'active' });
  for (const u of ['employee', 'external']) tx.project_members.rows.push({ project_id: 'p1', user_id: u });
  const prisma = { runAsAdmin: (fn: (t: unknown) => unknown) => fn(tx) };
  return { tx, prisma };
}

describe('Active Question Chats HTTP', () => {
  let app: INestApplication;
  let db: ReturnType<typeof makeDb>;

  beforeEach(async () => {
    db = makeDb();
    const moduleRef = await Test.createTestingModule({
      controllers: [ActiveQuestionChatsController, GeneralChannelsController],
      providers: [
        ActiveQuestionChatsService,
        GeneralChannelsService,
        RealtimeHubService,
        { provide: APP_INTERCEPTOR, useClass: QuestionMessagesInterceptor },
        { provide: PrismaService, useValue: db.prisma },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use((req: any, _res: any, next: () => void) => {
      const id = req.headers['x-test-user'];
      const u = db.tx.user.rows.find((r) => r.id === id);
      if (u) req.session = { userId: u.id, role: u.role };
      next();
    });
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const as = (user: string) => ({ 'x-test-user': user });
  const open = async (user = 'employee') =>
    request(app.getHttpServer())
      .post('/api/projects/p1/questions')
      .set(as(user))
      .send({ title: 'Which drawing revision?', body_html: '<p>Rev B or C?</p>' });

  it('creates an open question with its first message (201) and lists it', async () => {
    const res = await open();
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: 'Which drawing revision?', kind: 'question', status: 'open' });
    expect(res.body.first_message_id).toBeTruthy();
    expect(db.tx.channels.rows).toHaveLength(1);
    expect(db.tx.messages.rows).toHaveLength(1);

    const list = await request(app.getHttpServer()).get('/api/projects/p1/questions').set(as('external'));
    expect(list.status).toBe(200);
    expect(list.body.items[0]).toMatchObject({ id: res.body.id, name: 'Which drawing revision?', status: 'open', resolved_sides: '', unread_count: 0 });
  });

  it('rejects blank title or first message with 400 and stores nothing', async () => {
    const a = await request(app.getHttpServer()).post('/api/projects/p1/questions').set(as('employee')).send({ title: '  ', body_html: 'x' });
    const b = await request(app.getHttpServer()).post('/api/projects/p1/questions').set(as('employee')).send({ title: 'T', body_html: '' });
    expect(a.status).toBe(400);
    expect(b.status).toBe(400);
    expect(db.tx.channels.rows).toHaveLength(0);
  });

  it('returns 401 unauthenticated and 403 for non-members', async () => {
    const q = (await open()).body.id;
    expect((await request(app.getHttpServer()).get('/api/projects/p1/questions')).status).toBe(401);
    expect((await request(app.getHttpServer()).post(`/api/questions/${q}/resolve`)).status).toBe(401);
    expect((await request(app.getHttpServer()).get('/api/projects/p1/questions').set(as('outsider'))).status).toBe(403);
    expect((await request(app.getHttpServer()).get(`/api/channels/${q}/messages`).set(as('outsider'))).status).toBe(403);
    expect((await request(app.getHttpServer()).post(`/api/questions/${q}/resolve`).set(as('outsider'))).status).toBe(403);
  });

  it('needs both parties to resolve; then further posts are 403', async () => {
    const q = (await open()).body.id;
    const first = await request(app.getHttpServer()).post(`/api/questions/${q}/resolve`).set(as('employee'));
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ id: q, status: 'open', resolved_sides: 'internal' });
    expect(db.tx.question_resolutions.rows).toHaveLength(1);

    const second = await request(app.getHttpServer()).post(`/api/questions/${q}/resolve`).set(as('external'));
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ status: 'resolved', resolved_sides: 'external,internal' });
    expect(db.tx.channels.rows[0].status).toBe('resolved');

    const post = await request(app.getHttpServer()).post(`/api/channels/${q}/messages`).set(as('employee')).send({ body_html: 'more' });
    expect(post.status).toBe(403);
  });

  it('withdrawing the mark deletes resolutions and keeps the question open', async () => {
    const q = (await open()).body.id;
    await request(app.getHttpServer()).post(`/api/questions/${q}/resolve`).set(as('external'));
    const res = await request(app.getHttpServer()).delete(`/api/questions/${q}/resolve`).set(as('external'));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: q, status: 'open', resolved_sides: '' });
    expect(db.tx.question_resolutions.rows).toHaveLength(0);
  });

  it('a new message clears resolution marks and keeps the question open', async () => {
    const q = (await open()).body.id;
    await request(app.getHttpServer()).post(`/api/questions/${q}/resolve`).set(as('employee'));
    const post = await request(app.getHttpServer()).post(`/api/channels/${q}/messages`).set(as('external')).send({ body_html: '<b>Rev C</b>' });
    expect(post.status).toBe(201);
    expect(db.tx.question_resolutions.rows).toHaveLength(0);
    expect(db.tx.channels.rows[0].status).toBe('open');
  });
});
