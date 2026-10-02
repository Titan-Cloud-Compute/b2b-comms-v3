import 'reflect-metadata';
import { UnauthorizedException, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request = require('supertest');
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { GeneralChannelsController } from './general-channels.controller';
import { GeneralChannelsService } from './general-channels.service';
import { RealtimeEvent, RealtimeHub } from './realtime.hub';

/* eslint-disable @typescript-eslint/no-explicit-any */

type Row = Record<string, any>;

function makeFakePrisma() {
  const users: Row[] = [
    { id: 'admin', email: 'admin@x', name: 'Admin', organization_id: 'org-int' },
    { id: 'mgr', email: 'mgr@x', name: 'Mgr', organization_id: 'org-int' },
    { id: 'emp', email: 'emp@x', name: 'Emp', organization_id: 'org-int' },
    { id: 'emp2', email: 'emp2@x', name: 'Emp2', organization_id: 'org-int' },
    { id: 'extA', email: 'ext@x', name: 'Ext', organization_id: 'org-a' },
  ];
  const organizations: Row[] = [
    { id: 'org-int', name: 'Us', type: 'other', is_internal: true },
    { id: 'org-a', name: 'Company A', type: 'vendor', is_internal: false },
  ];
  const projects: Row[] = [
    { id: 'p0', organization_id: 'org-a', name: 'P0', status: 'active', created_by: 'mgr' },
  ];
  const members: Row[] = [
    { project_id: 'p0', user_id: 'emp' },
    { project_id: 'p0', user_id: 'emp2' },
    { project_id: 'p0', user_id: 'extA' },
  ];
  const files: Row[] = [{ id: 'f1', project_id: 'p0', deleted_at: null }];
  const channels: Row[] = [];
  const messages: Row[] = [];
  const attachments: Row[] = [];
  let seq = 0;
  const nextId = (p: string) => `${p}-${++seq}`;
  const time = () => new Date(Date.UTC(2026, 0, 1, 0, 0, ++seq));

  const projectWith = (p: Row, include: any = {}) => ({
    ...p,
    ...(include.members ? { members: members.filter((m) => m.project_id === p.id) } : {}),
  });
  const messageWith = (m: Row, include: any = {}) => ({
    ...m,
    ...(include.attachments ? { attachments: attachments.filter((a) => a.message_id === m.id) } : {}),
    ...(include.author ? { author: users.find((u) => u.id === m.author_id) } : {}),
  });

  const db: any = {
    user: { findUnique: async ({ where }: any) => users.find((u) => u.id === where.id) ?? null },
    organizations: { findUnique: async ({ where }: any) => organizations.find((o) => o.id === where.id) ?? null },
    projects: {
      findUnique: async ({ where, include }: any) => {
        const p = projects.find((x) => x.id === where.id);
        return p ? projectWith(p, include) : null;
      },
    },
    files: {
      findMany: async ({ where }: any) =>
        files.filter((f) => where.id.in.includes(f.id) && f.project_id === where.project_id && !f.deleted_at),
    },
    channels: {
      findMany: async ({ where }: any) =>
        channels.filter(
          (c) =>
            c.project_id === where.project_id &&
            (where.kind === undefined || c.kind === where.kind) &&
            (where.internal_only === undefined || c.internal_only === where.internal_only),
        ),
      findUnique: async ({ where, include }: any) => {
        const c = channels.find((x) => x.id === where.id);
        if (!c) return null;
        const p = projects.find((x) => x.id === c.project_id)!;
        return include?.project ? { ...c, project: projectWith(p, include.project.include) } : { ...c };
      },
      create: async ({ data }: any) => {
        const row = { id: nextId('ch'), created_at: time(), ...data };
        channels.push(row);
        return row;
      },
    },
    messages: {
      findMany: async ({ where, include }: any) =>
        messages.filter((m) => m.channel_id === where.channel_id).map((m) => messageWith(m, include)),
      findUnique: async ({ where, include }: any) => {
        const m = messages.find((x) => x.id === where.id);
        return m ? messageWith(m, include) : null;
      },
      create: async ({ data, include }: any) => {
        const { attachments: nested, ...rest } = data;
        const row = { id: nextId('msg'), created_at: time(), edited_at: null, deleted_at: null, ...rest };
        messages.push(row);
        for (const a of nested?.create ?? []) attachments.push({ id: nextId('att'), message_id: row.id, ...a });
        return messageWith(row, include);
      },
      update: async ({ where, data, include }: any) => {
        const m = messages.find((x) => x.id === where.id)!;
        Object.assign(m, data);
        return messageWith(m, include);
      },
    },
    message_attachments: {
      count: async ({ where }: any) => attachments.filter((a) => a.message_id === where.message_id).length,
    },
  };
  return { db, channels, messages, attachments };
}

const sessions: Record<string, any> = {
  admin: { userId: 'admin', role: 'ADMIN', firmId: null, organizationId: 'org-int' },
  mgr: { userId: 'mgr', role: 'MANAGER', firmId: null, organizationId: 'org-int' },
  emp: { userId: 'emp', role: 'USER', firmId: null, organizationId: 'org-int' },
  emp2: { userId: 'emp2', role: 'USER', firmId: null, organizationId: 'org-int' },
  extA: { userId: 'extA', role: 'USER', firmId: null, organizationId: 'org-a' },
};

describe('General Channels HTTP', () => {
  let app: INestApplication;
  let fake: ReturnType<typeof makeFakePrisma>;
  let hub: RealtimeHub;

  beforeEach(async () => {
    fake = makeFakePrisma();
    const mod = await Test.createTestingModule({
      controllers: [GeneralChannelsController],
      providers: [
        GeneralChannelsService,
        ProjectsService,
        RealtimeHub,
        { provide: PrismaService, useValue: fake.db },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: any) => {
          const req = ctx.switchToHttp().getRequest();
          const who = req.headers['x-test-user'];
          if (!who || !sessions[who]) throw new UnauthorizedException('not authenticated');
          req.session = sessions[who];
          return true;
        },
      })
      .compile();
    app = mod.createNestApplication();
    await app.init();
    hub = app.get(RealtimeHub);
  });

  afterEach(async () => {
    await app.close();
  });

  const as = (who: string) => ({
    get: (url: string) => request(app.getHttpServer()).get(url).set('x-test-user', who),
    post: (url: string, body?: any) => request(app.getHttpServer()).post(url).set('x-test-user', who).send(body ?? {}),
    patch: (url: string, body?: any) => request(app.getHttpServer()).patch(url).set('x-test-user', who).send(body ?? {}),
    delete: (url: string) => request(app.getHttpServer()).delete(url).set('x-test-user', who),
  });

  async function makeChannel(internalOnly = false): Promise<string> {
    const res = await as('mgr').post('/api/projects/p0/channels', { name: 'design', internalOnly });
    expect(res.status).toBe(201);
    return res.body.id;
  }

  it('a manager creates a general channel that appears in the list', async () => {
    const res = await as('mgr').post('/api/projects/p0/channels', { name: 'design', internalOnly: true });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ kind: 'general', name: 'design', internalOnly: true, projectId: 'p0' });
    expect(fake.channels).toHaveLength(1);
    const list = await as('admin').get('/api/projects/p0/channels');
    expect(list.status).toBe(200);
    expect(list.body.map((c: any) => c.name)).toEqual(['design']);
  });

  it('an employee cannot create a channel', async () => {
    const res = await as('emp').post('/api/projects/p0/channels', { name: 'nope' });
    expect(res.status).toBe(403);
    expect(fake.channels).toHaveLength(0);
  });

  it('internal-only channels are hidden from external users and return 403', async () => {
    const internal = await makeChannel(true);
    const open = await makeChannel(false);
    const list = await as('extA').get('/api/projects/p0/channels');
    expect(list.status).toBe(200);
    expect(list.body.map((c: any) => c.id)).toEqual([open]);
    expect((await as('extA').get(`/api/channels/${internal}/messages`)).status).toBe(403);
    expect((await as('extA').post(`/api/channels/${internal}/messages`, { bodyHtml: 'hi' })).status).toBe(403);
    expect((await as('extA').get(`/api/channels/${open}/messages`)).status).toBe(200);
  });

  it('stores a sanitized rich-text message with attachments and pushes message.created', async () => {
    const ch = await makeChannel(true);
    const got: Record<string, RealtimeEvent[]> = { emp2: [], extA: [] };
    hub.subscribe({ actor: { userId: 'emp2', role: 'USER', organizationId: 'org-int', isExternal: false }, send: (e) => got.emp2.push(e) });
    hub.subscribe({ actor: { userId: 'extA', role: 'USER', organizationId: 'org-a', isExternal: true }, send: (e) => got.extA.push(e) });

    const res = await as('emp').post(`/api/channels/${ch}/messages`, {
      bodyHtml: '<b>bold</b><ul><li>x</li></ul><script>alert(1)</script><img src=x onerror=alert(1)>',
      attachmentFileIds: ['f1'],
    });
    expect(res.status).toBe(201);
    expect(res.body.bodyHtml).toBe('<b>bold</b><ul><li>x</li></ul>');
    expect(fake.messages).toHaveLength(1);
    expect(fake.messages[0].body_html).not.toMatch(/<script|onerror/i);
    expect(fake.attachments).toEqual([expect.objectContaining({ message_id: res.body.id, file_id: 'f1' })]);
    expect(got.emp2.map((e) => e.type)).toEqual(['message.created']);
    expect((got.emp2[0].payload as any).bodyHtml).toBe('<b>bold</b><ul><li>x</li></ul>');
    expect(got.extA).toHaveLength(0);

    const list = await as('emp2').get(`/api/channels/${ch}/messages`);
    expect(list.status).toBe(200);
    expect(list.body.map((m: any) => m.id)).toEqual([res.body.id]);
  });

  it('rejects a blank message with 400 and stores nothing', async () => {
    const ch = await makeChannel();
    expect((await as('emp').post(`/api/channels/${ch}/messages`, { bodyHtml: '  <p>&nbsp;</p> ' })).status).toBe(400);
    expect((await as('emp').post(`/api/channels/${ch}/messages`, {})).status).toBe(400);
    expect(fake.messages).toHaveLength(0);
  });

  it('only the author can edit or delete a message', async () => {
    const ch = await makeChannel();
    const posted = await as('emp').post(`/api/channels/${ch}/messages`, { bodyHtml: 'hello' });
    const id = posted.body.id;
    expect((await as('emp2').patch(`/api/messages/${id}`, { bodyHtml: 'hacked' })).status).toBe(403);
    expect((await as('emp2').delete(`/api/messages/${id}`)).status).toBe(403);

    const edited = await as('emp').patch(`/api/messages/${id}`, { bodyHtml: '<i>hello again</i>' });
    expect(edited.status).toBe(200);
    expect(edited.body.editedAt).toBeTruthy();
    expect(fake.messages[0].edited_at).toBeInstanceOf(Date);

    expect((await as('emp').delete(`/api/messages/${id}`)).status).toBe(204);
    expect(fake.messages[0].deleted_at).toBeInstanceOf(Date);
    const list = await as('emp2').get(`/api/channels/${ch}/messages`);
    expect(list.body[0]).toMatchObject({ id, bodyHtml: '' });
    expect(list.body[0].deletedAt).toBeTruthy();
  });

  it('unauthenticated requests get 401', async () => {
    const ch = await makeChannel();
    expect((await request(app.getHttpServer()).get(`/api/channels/${ch}/messages`)).status).toBe(401);
    expect((await request(app.getHttpServer()).get('/api/realtime/socket')).status).toBe(401);
    expect((await request(app.getHttpServer()).get('/api/projects/p0/channels')).status).toBe(401);
  });
});
