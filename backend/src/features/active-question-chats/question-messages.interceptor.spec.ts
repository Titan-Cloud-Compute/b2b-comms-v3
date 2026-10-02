import { ForbiddenException } from '@nestjs/common';
import { firstValueFrom, of } from 'rxjs';
import { QuestionMessagesInterceptor, questionMessageTarget } from './question-messages.interceptor';

/* eslint-disable @typescript-eslint/no-explicit-any */
function ctx(req: any): any {
  return { getType: () => 'http', switchToHttp: () => ({ getRequest: () => req }) };
}

function svc(state: { kind: string; status: string }) {
  return {
    cleared: 0,
    async assertCanPost() {
      if (state.kind === 'question' && state.status === 'resolved') throw new ForbiddenException('resolved');
      return state.kind === 'question';
    },
    async clearResolutions() {
      this.cleared++;
    },
  };
}

const post = (id: string) => ({ method: 'POST', originalUrl: `/api/channels/${id}/messages`, session: { userId: 'u1' } });

describe('QuestionMessagesInterceptor', () => {
  it('only targets POST /api/channels/:id/messages', () => {
    expect(questionMessageTarget(post('q1'))).toBe('q1');
    expect(questionMessageTarget({ method: 'GET', originalUrl: '/api/channels/q1/messages' })).toBeNull();
    expect(questionMessageTarget({ method: 'POST', originalUrl: '/api/projects/p1/questions' })).toBeNull();
  });

  it('blocks posts to a resolved question with 403 without calling the handler', async () => {
    const s = svc({ kind: 'question', status: 'resolved' });
    const handle = jest.fn(() => of({ id: 'm1' }));
    const i = new QuestionMessagesInterceptor(s as any);
    await expect(firstValueFrom(i.intercept(ctx(post('q1')), { handle }))).rejects.toBeInstanceOf(ForbiddenException);
    expect(handle).not.toHaveBeenCalled();
  });

  it('clears resolution marks after a message lands in an open question', async () => {
    const s = svc({ kind: 'question', status: 'open' });
    const i = new QuestionMessagesInterceptor(s as any);
    const out = await firstValueFrom(i.intercept(ctx(post('q1')), { handle: () => of({ id: 'm1' }) }));
    expect(out).toEqual({ id: 'm1' });
    expect(s.cleared).toBe(1);
  });

  it('leaves general channel posts untouched', async () => {
    const s = svc({ kind: 'general', status: 'active' });
    const i = new QuestionMessagesInterceptor(s as any);
    await firstValueFrom(i.intercept(ctx(post('c1')), { handle: () => of({ id: 'm1' }) }));
    expect(s.cleared).toBe(0);
  });
});
