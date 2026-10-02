import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request = require('supertest');
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

type Row = Record<string, any>;

function makeFakePrisma() {
  const users: Row[] = [
    { id: 'admin', organization_id: 'org-int' },
    { id: 'mgr', organization_id: 'org-int' },
    { id: 'emp', organization_id: 'org-int' },
    { id: 'extA', organization_id: 'org-a' },
  ];
  const organizations: Row[] = [
    { id: 'org-int', name: 'Us', type: 'other', is_internal: true },
    { id: 'org-a', name: 'Company A', type: 'vendor', is_internal: false },
    { id: 'org-b', name: 'Company B', type: 'client', is_internal: false },
  ];
  const projects: Row[] = [];
  const members: Row[] = [];
  const channels: Row[] = [];
  let seq = 0;
  const id = (p: string) => `${p}-${++seq}`;

  for (let i = 0; i < 5; i++) {
    const org = i === 0 ? 'org-a' : 'org-b';
    projects.push({ id: `p${i}`, organization_id: org, name: `P${i}`, status: 'active', created_by: 'mgr', created_at: new Date(2026, 0, i + 1) });
  }
  members.push({ project_id: 'p0', user_id: 'emp' }, { project_id: 'p1', user_id: 'emp' });
  members.push({ project_id: 'p0', user_id: 'extA' }, { project_id: 'p2', user_id: 'extA' });

  const matches = (p: Row, where: any = {}) => {
    if (where.status?.not && p.status === where.status.not) return false;
    if (where.organization_id && p.organization_id !== where.organization_id) return false;
    if (where.members?.some?.user_id) {
      if (!members.some((m) => m.project_id === p.id && m.user_id === where.members.some.user_id)) return false;
    }
    return true;
  };
  const withIncludes = (p: Row, include: any = {}) => ({
    ...p,
    ...(include.organization ? { organization: organizations.find((o) => o.id === p.organization_id) } : {}),
    ...(include.members ? { members: members.filter((m) => m.project_id === p.id) } : {}),
  });

  const db: any = {
    user: { findUnique: async ({ where }: any) => users.find((u) => u.id === where.id) ?? null },
    organizations: {
      findUnique: async ({ where }: any) => organizations.find((o) => o.id === where.id) ?? null,
      create: async ({ data }: any) => {
        const row = { id: id('org'), created_at: new Date(), ...data };
        organizations.push(row);
        return row;
      },
    },
    projects: {
      findMany: async ({ where, include, skip = 0, take = 25 }: any) =>
        projects.filter((p) => matches(p, where)).slice(skip, skip + take).map((p) => withIncludes(p, include)),
      count: async ({ where }: any) => projects.filter((p) => matches(p, where)).length,
      findUnique: async ({ where, include }: any) => {
        const p = projects.find((x) => x.id === where.id);
        return p ? withIncludes(p, include) : null;
      },
      create: async ({ data }: any) => {
        const row = { id: id('proj'), created_at: new Date(), ...data };
        projects.push(row);
        return row;
      },
      update: async ({ where, data, include }: any) => {
        const p = projects.find((x) => x.id === where.id)!;
        Object.assign(p, data);
        return withIncludes(p, include);
      },
    },
    project_members: {
      create: async ({ data }: any) => {
        members.push(data);
        return data;
      },
      upsert: async ({ create }: any) => {
        if (!members.some((m) => m.project_id === create.project_id && m.user_id === create.user_id)) members.push(create);
        return create;
      },
    },
    channels: {
      create: async ({ data }: any) => {
        const row = { id: id('ch'), ...data };
        channels.push(row);
        return row;
      },
    },
    $transaction: async (fn: any) => fn(db),
  };
  return { db, projects, organizations, channels, members };
}

const sessions: Record<string, any> = {
  admin: { userId: 'admin', role: 'ADMIN', firmId: null, organizationId: 'org-int' },
  mgr: { userId: 'mgr', role: 'MANAGER', firmId: null, organizationId: 'org-int' },
  emp: { userId: 'emp', role: 'USER', firmId: null, organizationId: 'org-int' },
  extA: { userId: 'extA', role: 'USER', firmId: null, organizationId: 'org-a' },
};

describe('Projects HTTP API (/api/projects)', () => {
  let app: INestApplication;
  let fake: ReturnType<typeof makeFakePrisma>;

  beforeEach(async () => {
    fake = makeFakePrisma();
    const mod = await Test.createTestingModule({
      controllers: [ProjectsController],
      providers: [ProjectsService, { provide: PrismaService, useValue: fake.db }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: any) => {
          const req = ctx.switchToHttp().getRequest();
          const who = req.headers['x-test-user'];
          if (!who || !sessions[who]) return false;
          req.session = sessions[who];
          return true;
        },
      })
      .compile();
    app = mod.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const as = (who: string) => ({
    get: (url: string) => request(app.getHttpServer()).get(url).set('x-test-user', who),
    post: (url: string, body?: any) => request(app.getHttpServer()).post(url).set('x-test-user', who).send(body ?? {}),
    patch: (url: string, body?: any) => request(app.getHttpServer()).patch(url).set('x-test-user', who).send(body ?? {}),
  });

  it('manager creates a project: 201 with org, project and a "general" channel', async () => {
    const res = await as('mgr').post('/api/projects', { organizationName: 'Acme', organizationType: 'customer' });
    expect(res.status).toBe(201);
    expect(res.body.organizationName).toBe('Acme');
    expect(fake.organizations.some((o) => o.name === 'Acme' && o.type === 'customer')).toBe(true);
    expect(fake.channels).toEqual([expect.objectContaining({ project_id: res.body.id, name: 'general' })]);
  });

  it('employee cannot create a project (403, no row)', async () => {
    const before = fake.projects.length;
    const res = await as('emp').post('/api/projects', { organizationName: 'Acme', organizationType: 'vendor' });
    expect(res.status).toBe(403);
    expect(fake.projects.length).toBe(before);
  });

  it('blank organization name is 400 with no project created', async () => {
    const before = fake.projects.length;
    const res = await as('mgr').post('/api/projects', { organizationName: '  ', organizationType: 'vendor' });
    expect(res.status).toBe(400);
    expect(fake.projects.length).toBe(before);
  });

  it('employee lists exactly their two assigned projects with organization names', async () => {
    const res = await as('emp').get('/api/projects');
    expect(res.status).toBe(200);
    expect(res.body.items.map((p: any) => p.id).sort()).toEqual(['p0', 'p1']);
    for (const p of res.body.items) expect(typeof p.organizationName).toBe('string');
  });

  it('external user only sees own company projects and gets 403 on another company', async () => {
    const list = await as('extA').get('/api/projects');
    expect(list.body.items.map((p: any) => p.id)).toEqual(['p0']);
    const other = await as('extA').get('/api/projects/p2');
    expect(other.status).toBe(403);
    expect(JSON.stringify(other.body)).not.toContain('Company B');
    expect((await as('extA').get('/api/projects/p0')).status).toBe(200);
  });

  it('admin archives: 200, hidden from default list, writes 403, data retained', async () => {
    const res = await as('admin').post('/api/projects/p1/archive');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('archived');
    const list = await as('admin').get('/api/projects');
    expect(list.body.items.map((p: any) => p.id)).not.toContain('p1');
    expect((await as('admin').patch('/api/projects/p1', { name: 'x' })).status).toBe(403);
    expect(fake.projects.find((p) => p.id === 'p1')).toBeDefined();
  });

  it('manager cannot archive', async () => {
    expect((await as('mgr').post('/api/projects/p1/archive')).status).toBe(403);
  });

  it('adds a member', async () => {
    const res = await as('mgr').post('/api/projects/p3/members', { userId: 'emp' });
    expect(res.status).toBe(201);
    expect(fake.members.some((m) => m.project_id === 'p3' && m.user_id === 'emp')).toBe(true);
  });
});
