/**
 * Story: Unread Message Indicators — HTTP layer (real Nest app + supertest, in-memory DB).
 * Includes General Channels' message endpoints so the post/view interceptor is exercised.
 */
import { INestApplication } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request = require('supertest');
import { PrismaService } from '../../prisma/prisma.service';
import { GeneralChannelsController } from '../general-channels/general-channels.controller';
import { GeneralChannelsService } from '../general-channels/general-channels.service';
import { RealtimeHubService } from '../general-channels/realtime-hub.service';
import { UnreadMessageIndicatorsController } from './unread-message-indicators.controller';
import { UnreadMessageIndicatorsInterceptor } from './unread-message-indicators.interceptor';
import { UnreadMessageIndicatorsService } from './unread-message-indicators.service';

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
    const row = { id: `${this.prefix}${String(++this.seq).padStart(4, '0')}`, created_at: new Date(), ...args.data };
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
  async count(args: { where?: Row } = {}) {
    return this.rows.filter((r) => matches(r, args.where)).length;
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
    { id: 'admin', email: 'admin@x', name: 'Ada', role: 'ADMIN', organizationId: null },
    { id: 'employee', email: 'emp@x', name: 'Eve', role: 'USER', organizationId: null },
    { id: 'employee2', email: 'emp2@x', name: 'Ed', role: 'USER', organizationId: null },
    { id: 'external', email: 'ext@x', name: 'Xavier', role: 'USER', organizationId: 'org-ext' },
  );
  tx.projects.rows.push({ id: 'p1', organization_id: 'org-ext', name: 'Globex', status: 'active', created_by: 'admin' });
  for (const u of ['employee', 'employee2', 'external']) tx.project_members.rows.push({ project_id: 'p1', user_id: u });
  tx.channels.rows.push(
    { id: 'ch-general', project_id: 'p1', kind: 'general', name: 'General', internal_only: false, status: 'open' },
    { id: 'ch-internal', project_id: 'p1', kind: 'general', name: 'Internal', internal_only: true, status: 'open' },
  );
  const prisma = { runAsAdmin: (fn: (t: unknown) => unknown) => fn(tx) };
  return { tx, prisma };
}

const settle = () => new Promise((r) => setTimeout(r, 20));

describe('Unread Message Indicators HTTP', () => {
  let app: INestApplication;
  let db: ReturnType<typeof makeDb>;
  let hub: RealtimeHubService;

  beforeEach(async () => {
    db = makeDb();
    const moduleRef = await Test.createTestingModule({
      controllers: [UnreadMessageIndicatorsController, GeneralChannelsController],
      providers: [
        UnreadMessageIndicatorsService,
        GeneralChannelsService,
        RealtimeHubService,
        { provide: APP_INTERCEPTOR, useClass: UnreadMessageIndicatorsInterceptor },
        { provide: PrismaService, useValue: db.prisma },
      ],
    }).compile();
    hub = moduleRef.get(RealtimeHubService);
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
  const countFor = (user: string, channel: string) =>
    db.tx.channel_read_state.rows.find((r) => r.user_id === user && r.channel_id === channel)?.unread_count ?? 0;
  const post = async (user: string, channel: string) => {
    const res = await request(app.getHttpServer()).post(`/api/channels/${channel}/messages`).set(as(user)).send({ body_html: '<p>hi</p>' });
    await settle();
    return res;
  };

  it('returns 401 for unauthenticated unread requests', async () => {
    expect((await request(app.getHttpServer()).get('/api/projects/p1/unread')).status).toBe(401);
    expect((await request(app.getHttpServer()).post('/api/channels/ch-general/read')).status).toBe(401);
  });

  it('increments unread for other members, the privileged non-member and the creator, publishing unread.changed', async () => {
    const spy = jest.spyOn(hub, 'publish');
    const res = await post('employee', 'ch-general');
    expect(res.status).toBe(201);
    expect(countFor('employee', 'ch-general')).toBe(0);
    expect(countFor('employee2', 'ch-general')).toBe(1);
    expect(countFor('external', 'ch-general')).toBe(1);
    expect(countFor('admin', 'ch-general')).toBe(1);
    expect(spy.mock.calls.some(([e]: any[]) => e.type === 'unread.changed' && e.channel_id === 'ch-general' && e.payload.user_id === 'admin')).toBe(true);

    await post('employee', 'ch-general');
    const list = await request(app.getHttpServer()).get('/api/projects/p1/unread').set(as('admin'));
    expect(list.status).toBe(200);
    expect(list.body.counts).toEqual(expect.arrayContaining([{ channel_id: 'ch-general', unread_count: 2 }]));
  });

  it('marks read for only the reader (200, unread_count 0)', async () => {
    await post('employee', 'ch-general');
    const res = await request(app.getHttpServer()).post('/api/channels/ch-general/read').set(as('employee2'));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ channel_id: 'ch-general', unread_count: 0 });
    expect(countFor('employee2', 'ch-general')).toBe(0);
    expect(countFor('admin', 'ch-general')).toBe(1);
  });

  it('hides internal-only channels from external users (omitted + 403)', async () => {
    await post('employee', 'ch-internal');
    expect(countFor('external', 'ch-internal')).toBe(0);
    const list = await request(app.getHttpServer()).get('/api/projects/p1/unread').set(as('external'));
    expect(list.status).toBe(200);
    expect(list.body.counts.map((c: any) => c.channel_id)).not.toContain('ch-internal');
    expect((await request(app.getHttpServer()).post('/api/channels/ch-internal/read').set(as('external'))).status).toBe(403);
  });
});
