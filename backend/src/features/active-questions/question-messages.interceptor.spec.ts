import 'reflect-metadata';
import { UnauthorizedException, type INestApplication } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request = require('supertest');
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { GeneralChannelsController } from '../general-channels/general-channels.controller';
import { GeneralChannelsService } from '../general-channels/general-channels.service';
import { RealtimeHub } from '../general-channels/realtime.hub';
import { ActiveQuestionsController } from './active-questions.controller';
import { ActiveQuestionsService } from './active-questions.service';
import { QuestionMessagesInterceptor } from './question-messages.interceptor';
import { TEST_SESSIONS, makeQuestionFakePrisma } from './question-fake-prisma';

/* eslint-disable @typescript-eslint/no-explicit-any */

describe('Question message-post hook', () => {
  let app: INestApplication;
  let fake: ReturnType<typeof makeQuestionFakePrisma>;

  beforeEach(async () => {
    fake = makeQuestionFakePrisma();
    const mod = await Test.createTestingModule({
      controllers: [GeneralChannelsController, ActiveQuestionsController],
      providers: [
        GeneralChannelsService,
        RealtimeHub,
        ActiveQuestionsService,
        ProjectsService,
        QuestionMessagesInterceptor,
        { provide: APP_INTERCEPTOR, useExisting: QuestionMessagesInterceptor },
        { provide: PrismaService, useValue: fake.db },
      ],
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
    post: (url: string, body?: any) => request(app.getHttpServer()).post(url).set('x-test-user', who).send(body ?? {}),
  });

  async function open(): Promise<string> {
    const res = await as('emp').post('/api/projects/p0/questions', { title: 'Q', bodyHtml: 'first' });
    expect(res.status).toBe(201);
    return res.body.id;
  }

  it('a rich-text message with attachments posts to an open question and clears resolution marks', async () => {
    const id = await open();
    await as('emp').post(`/api/questions/${id}/resolve`);
    expect(fake.resolutions).toHaveLength(1);
    const res = await as('extA').post(`/api/channels/${id}/messages`, {
      bodyHtml: '<b>more</b><script>x</script>',
      attachmentFileIds: ['f1'],
    });
    expect(res.status).toBe(201);
    expect(res.body.bodyHtml).toBe('<b>more</b>');
    expect(res.body.attachments).toEqual([expect.objectContaining({ fileId: 'f1' })]);
    expect(fake.resolutions).toHaveLength(0);
    expect(fake.channels[0].status).toBe('open');
  });

  it('posting to a resolved question returns 403 and stores nothing', async () => {
    const id = await open();
    await as('emp').post(`/api/questions/${id}/resolve`);
    await as('extA').post(`/api/questions/${id}/resolve`);
    expect(fake.channels[0].status).toBe('resolved');
    const before = fake.messages.length;
    const res = await as('emp').post(`/api/channels/${id}/messages`, { bodyHtml: 'late' });
    expect(res.status).toBe(403);
    expect(fake.messages).toHaveLength(before);
    expect(fake.resolutions).toHaveLength(2);
  });

  it('a failed post (blank) does not clear resolution marks', async () => {
    const id = await open();
    await as('emp').post(`/api/questions/${id}/resolve`);
    expect((await as('emp').post(`/api/channels/${id}/messages`, { bodyHtml: ' ' })).status).toBe(400);
    expect(fake.resolutions).toHaveLength(1);
  });

  it('general channels are untouched by the hook', async () => {
    fake.channels.push({ id: 'gen', project_id: 'p0', kind: 'general', name: 'general', internal_only: false, status: 'open' });
    expect((await as('emp').post('/api/channels/gen/messages', { bodyHtml: 'hi' })).status).toBe(201);
  });
});
