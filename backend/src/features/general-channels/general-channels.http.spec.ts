/**
 * Story: General Channels — HTTP layer (real Nest app + supertest, in-memory DB).
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as http from 'http';
import type { AddressInfo } from 'net';
import request = require('supertest');
import { PrismaService } from '../../prisma/prisma.service';
import { FEATURE_MODULES } from '../index';
import { GeneralChannelsController } from './general-channels.controller';
import { GeneralChannelsModule } from './general-channels.module';
import { GeneralChannelsService } from './general-channels.service';
import { RealtimeHubService } from './realtime-hub.service';

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
  async findMany(args: { where?: Row; orderBy?: Row[]; take?: number } = {}) {
    let all = this.rows.filter((r) => matches(r, args.where));
    if (args.orderBy) {
      all = [...all].sort((a, b) => {
        for (const o of args.orderBy!) {
          const [k, dir] = Object.entries(o)[0];
          const av = a[k] instanceof Date ? a[k].getTime() : a[k];
          const bv = b[k] instanceof Date ? b[k].getTime() : b[k];
          if (av === bv) continue;
          return (av < bv ? -1 : 1) * (dir === 'desc' ? -1 : 1);
        }
        return 0;
      });
    }
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
  };
  tx.organizations.rows.push({ id: 'org-ext', name: 'Globex', is_internal: false });
  tx.user.rows.push(
    { id: 'admin', email: 'admin@x', name: 'Ada Admin', role: 'ADMIN', organizationId: null },
    { id: 'manager', email: 'manager@x', name: 'Max Manager', role: 'MANAGER', organizationId: null },
    { id: 'employee', email: 'emp@x', name: 'Eve Employee', role: 'USER', organizationId: null },
    { id: 'external', email: 'ext@x', name: 'Xavier', role: 'USER', organizationId: 'org-ext' },
  );
  tx.projects.rows.push({ id: 'p1', organization_id: 'org-ext', name: 'Globex', status: 'active' });
  for (const u of ['employee', 'external']) tx.project_members.rows.push({ project_id: 'p1', user_id: u });
  tx.files.rows.push({ id: 'file1', project_id: 'p1', name: 'brief.pdf' });
  const prisma = { runAsAdmin: (fn: (t: unknown) => unknown) => fn(tx) };
  return { tx, prisma };
}

describe('General Channels HTTP', () => {
  let app: INestApplication;
  let db: ReturnType<typeof makeDb>;

  beforeEach(async () => {
    db = makeDb();
    const moduleRef = await Test.createTestingModule({
      controllers: [GeneralChannelsController],
      providers: [GeneralChannelsService, RealtimeHubService, { provide: PrismaService, useValue: db.prisma }],
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

  it('is registered in FEATURE_MODULES', () => {
    expect(FEATURE_MODULES).toContain(GeneralChannelsModule);
  });

  it('401 for unauthenticated channel, message and socket requests', async () => {
    const srv = app.getHttpServer();
    await request(srv).get('/api/projects/p1/channels').expect(401);
    await request(srv).get('/api/channels/x/messages').expect(401);
    await request(srv).get('/api/realtime/socket?channel_id=x').expect(401);
  });

  it('lists the default "general" channel and creates new channels', async () => {
    const srv = app.getHttpServer();
    const list = await request(srv).get('/api/projects/p1/channels').set(as('manager')).expect(200);
    expect(list.body.general.map((c: any) => c.name)).toEqual(['general']);
    expect(list.body.general[0]).toMatchObject({ internal_only: false, unread_count: 0 });
    expect(db.tx.channels.rows.filter((c) => c.kind === 'general')).toHaveLength(1);

    const created = await request(srv)
      .post('/api/projects/p1/channels')
      .set(as('admin'))
      .send({ name: 'design', internal_only: true })
      .expect(201);
    expect(created.body).toMatchObject({ name: 'design', kind: 'general', internal_only: true, status: 'active' });

    await request(srv).post('/api/projects/p1/channels').set(as('manager')).send({ name: '  ' }).expect(400);
  });

  it('renames a legacy "General" default channel to "general"', async () => {
    db.tx.channels.rows.push({ id: 'legacy', project_id: 'p1', kind: 'general', name: 'General', internal_only: false });
    const list = await request(app.getHttpServer()).get('/api/projects/p1/channels').set(as('manager')).expect(200);
    expect(list.body.general).toEqual([{ id: 'legacy', name: 'general', internal_only: false, unread_count: 0 }]);
  });

  it('employee cannot create a channel (403, no row)', async () => {
    const before = db.tx.channels.rows.length;
    await request(app.getHttpServer()).post('/api/projects/p1/channels').set(as('employee')).send({ name: 'x' }).expect(403);
    expect(db.tx.channels.rows.length).toBe(before);
  });

  it('internal-only channels are hidden from and forbidden to external users', async () => {
    const srv = app.getHttpServer();
    const ch = await request(srv).post('/api/projects/p1/channels').set(as('manager')).send({ name: 'internal', internal_only: true });
    const list = await request(srv).get('/api/projects/p1/channels').set(as('external')).expect(200);
    expect(list.body.general.map((c: any) => c.id)).not.toContain(ch.body.id);
    await request(srv).get(`/api/channels/${ch.body.id}/messages`).set(as('external')).expect(403);
    await request(srv).get(`/api/channels/${ch.body.id}/messages`).set(as('employee')).expect(200);
  });

  it('posts sanitized rich-text messages, rejects blanks, pages with a cursor', async () => {
    const srv = app.getHttpServer();
    const list = await request(srv).get('/api/projects/p1/channels').set(as('manager'));
    const id = list.body.general[0].id;

    await request(srv).post(`/api/channels/${id}/messages`).set(as('employee')).send({ body_html: ' <p> </p> ' }).expect(400);
    expect(db.tx.messages.rows).toHaveLength(0);

    const res = await request(srv)
      .post(`/api/channels/${id}/messages`)
      .set(as('employee'))
      .send({ body_html: '<b>Hello</b><script>alert(1)</script><i onclick="x()">it</i>', file_ids: ['file1'] })
      .expect(201);
    expect(res.body).toMatchObject({ channel_id: id, author_id: 'employee', body_html: '<b>Hello</b><i>it</i>' });
    expect(db.tx.message_attachments.rows).toEqual([expect.objectContaining({ message_id: res.body.id, file_id: 'file1' })]);

    const page = await request(srv).get(`/api/channels/${id}/messages`).set(as('manager')).expect(200);
    expect(page.body.items[0]).toMatchObject({
      id: res.body.id,
      author: { id: 'employee', display_name: 'Eve Employee' },
      body_html: '<b>Hello</b><i>it</i>',
      attachments: [{ file_id: 'file1', name: 'brief.pdf' }],
      edited_at: null,
    });
    expect(page.body.next_cursor).toBeNull();

    for (let i = 0; i < 3; i++) {
      db.tx.messages.rows.push({ id: `old${i}`, channel_id: id, author_id: 'manager', body_html: `m${i}`, created_at: new Date(2020, 0, i + 1), deleted_at: null });
    }
    const p1 = await request(srv).get(`/api/channels/${id}/messages?limit=2`).set(as('manager')).expect(200);
    expect(p1.body.items).toHaveLength(2);
    expect(p1.body.next_cursor).toBeTruthy();
    const p2 = await request(srv)
      .get(`/api/channels/${id}/messages?limit=2&cursor=${encodeURIComponent(p1.body.next_cursor)}`)
      .set(as('manager'))
      .expect(200);
    expect(p2.body.items.map((m: any) => m.id)).toEqual(['old1', 'old0']);
  });

  it('only the author edits or deletes a message', async () => {
    const srv = app.getHttpServer();
    const list = await request(srv).get('/api/projects/p1/channels').set(as('manager'));
    const id = list.body.general[0].id;
    const msg = await request(srv).post(`/api/channels/${id}/messages`).set(as('employee')).send({ body_html: 'hi' });

    await request(srv).patch(`/api/messages/${msg.body.id}`).set(as('admin')).send({ body_html: 'hacked' }).expect(403);
    await request(srv).delete(`/api/messages/${msg.body.id}`).set(as('manager')).expect(403);

    const edited = await request(srv)
      .patch(`/api/messages/${msg.body.id}`)
      .set(as('employee'))
      .send({ body_html: '<b>hi</b><img src=x onerror=alert(1)>' })
      .expect(200);
    expect(edited.body).toMatchObject({ id: msg.body.id, body_html: '<b>hi</b>' });
    expect(edited.body.edited_at).toBeTruthy();

    await request(srv).delete(`/api/messages/${msg.body.id}`).set(as('employee')).expect(204);
    expect(db.tx.messages.rows.find((m) => m.id === msg.body.id)!.deleted_at).toBeInstanceOf(Date);
    const page = await request(srv).get(`/api/channels/${id}/messages`).set(as('manager'));
    expect(page.body.items).toHaveLength(0);
  });

  it('streams message.created over /api/realtime/socket', async () => {
    await app.listen(0, '127.0.0.1');
    const port = (app.getHttpServer().address() as AddressInfo).port;
    const list = await request(app.getHttpServer()).get('/api/projects/p1/channels').set(as('manager'));
    const id = list.body.general[0].id;

    const received = new Promise<any>((resolve, reject) => {
      const req = http.get(
        { host: '127.0.0.1', port, path: `/api/realtime/socket?channel_id=${id}`, headers: as('employee') },
        (res) => {
          expect(res.statusCode).toBe(200);
          expect(res.headers['content-type']).toContain('text/event-stream');
          let buf = '';
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => {
            buf += chunk;
            if (buf.includes('event: ready')) {
              buf = buf.replace(/event: ready\ndata: .*\n\n/, '');
              void request(app.getHttpServer()).post(`/api/channels/${id}/messages`).set(as('manager')).send({ body_html: '<b>live</b>' }).then(() => undefined);
            }
            const m = /event: message\.created\ndata: (.*)\n\n/.exec(buf);
            if (m) {
              req.destroy();
              resolve(JSON.parse(m[1]));
            }
          });
        },
      );
      req.on('error', (e) => ((e as any).code === 'ECONNRESET' ? undefined : reject(e)));
      setTimeout(() => reject(new Error('timeout waiting for message.created')), 5000).unref();
    });

    const event = await received;
    expect(event).toMatchObject({ type: 'message.created', channel_id: id });
    expect(event.payload).toMatchObject({ body_html: '<b>live</b>', author: { id: 'manager' } });
  });

  it('socket requires a channel the user can see', async () => {
    const srv = app.getHttpServer();
    await request(srv).get('/api/realtime/socket').set(as('manager')).expect(400);
    const ch = await request(srv).post('/api/projects/p1/channels').set(as('manager')).send({ name: 'secret', internal_only: true });
    await request(srv).get(`/api/realtime/socket?channel_id=${ch.body.id}`).set(as('external')).expect(403);
  });
});
