import 'reflect-metadata';
import { UnauthorizedException, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request = require('supertest');
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { ActiveQuestionsController } from './active-questions.controller';
import { ActiveQuestionsService } from './active-questions.service';
import { TEST_SESSIONS, makeQuestionFakePrisma } from './question-fake-prisma';

/* eslint-disable @typescript-eslint/no-explicit-any */

describe('Active Questions HTTP', () => {
  let app: INestApplication;
  let fake: ReturnType<typeof makeQuestionFakePrisma>;

  beforeEach(async () => {
    fake = makeQuestionFakePrisma();
    const mod = await Test.createTestingModule({
      controllers: [ActiveQuestionsController],
      providers: [ActiveQuestionsService, ProjectsService, { provide: PrismaService, useValue: fake.db }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: any) => {
          const req = ctx.switchToHttp().getRequest();
          const who = req.headers['x-test-user'];
          if (!who || !TEST_SESSIONS[who]) throw new UnauthorizedException('not authenticated');
          req.session = TEST_SESSIONS[who];
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
    delete: (url: string) => request(app.getHttpServer()).delete(url).set('x-test-user', who),
  });

  async function open(who = 'emp'): Promise<string> {
    const res = await as(who).post('/api/projects/p0/questions', { title: 'Spec?', bodyHtml: '<b>which rev</b>' });
    expect(res.status).toBe(201);
    return res.body.id;
  }

  it('opens a question: channels row kind question/open plus a first message; listed afterwards', async () => {
    const res = await as('extA').post('/api/projects/p0/questions', {
      title: 'Which drawing?',
      bodyHtml: '<b>rev B</b><script>x</script>',
      attachmentFileIds: ['f1'],
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ kind: 'question', status: 'open', name: 'Which drawing?', resolvedSides: [] });
    expect(fake.channels).toEqual([expect.objectContaining({ kind: 'question', status: 'open', project_id: 'p0' })]);
    expect(fake.messages).toHaveLength(1);
    expect(fake.messages[0]).toMatchObject({ channel_id: res.body.id, author_id: 'extA', body_html: '<b>rev B</b>' });
    expect(fake.attachments).toEqual([expect.objectContaining({ file_id: 'f1' })]);

    const list = await as('emp').get('/api/projects/p0/questions');
    expect(list.status).toBe(200);
    expect(list.body.map((q: any) => q.id)).toEqual([res.body.id]);
  });

  it('rejects a blank title or first message with 400 and creates no channel', async () => {
    expect((await as('emp').post('/api/projects/p0/questions', { title: '  ', bodyHtml: 'hi' })).status).toBe(400);
    expect((await as('emp').post('/api/projects/p0/questions', { title: 'T', bodyHtml: ' <p>&nbsp;</p> ' })).status).toBe(400);
    expect((await as('emp').post('/api/projects/p0/questions', { title: 'T' })).status).toBe(400);
    expect(fake.channels).toHaveLength(0);
  });

  it('first party resolve keeps it open; second party resolves it', async () => {
    const id = await open('emp');
    const first = await as('emp').post(`/api/questions/${id}/resolve`);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ status: 'open', resolvedSides: ['internal'] });
    expect(fake.resolutions).toEqual([expect.objectContaining({ channel_id: id, side: 'internal', resolved_by: 'emp' })]);

    const second = await as('extA').post(`/api/questions/${id}/resolve`);
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ status: 'resolved', resolvedSides: ['external', 'internal'] });
    expect(fake.channels[0].status).toBe('resolved');
  });

  it('withdrawing a mark deletes the resolution rows and stays open', async () => {
    const id = await open('emp');
    await as('extA').post(`/api/questions/${id}/resolve`);
    const res = await as('extA').delete(`/api/questions/${id}/resolve`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'open', resolvedSides: [] });
    expect(fake.resolutions).toHaveLength(0);
    expect(fake.channels[0].status).toBe('open');
  });

  it('non-members get 403', async () => {
    const id = await open('emp');
    expect((await as('outsider').get('/api/projects/p0/questions')).status).toBe(403);
    expect((await as('outsider').post('/api/projects/p0/questions', { title: 'x', bodyHtml: 'y' })).status).toBe(403);
    expect((await as('extB').get(`/api/questions/${id}`)).status).toBe(403);
    expect((await as('extB').post(`/api/questions/${id}/resolve`)).status).toBe(403);
    expect((await as('outsider').delete(`/api/questions/${id}/resolve`)).status).toBe(403);
    expect(fake.resolutions).toHaveLength(0);
  });

  it('unauthenticated requests get 401', async () => {
    const id = await open('emp');
    expect((await request(app.getHttpServer()).get('/api/projects/p0/questions')).status).toBe(401);
    expect((await request(app.getHttpServer()).get(`/api/questions/${id}`)).status).toBe(401);
    expect((await request(app.getHttpServer()).post(`/api/questions/${id}/resolve`)).status).toBe(401);
  });
});
