import {
  CallHandler,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { Observable, from, mergeMap, switchMap } from 'rxjs';
import { CHANNEL_KIND_QUESTION, QUESTION_STATUS_RESOLVED } from './active-questions.policy';
import { ActiveQuestionsService } from './active-questions.service';

const POST_MESSAGE_PATH = /(?:^|\/)api\/channels\/([^/]+)\/messages\/?$/;

/**
 * Hook on the General Channels message-post route (POST /api/channels/:id/messages),
 * registered globally so that card's controller stays untouched:
 *  - posting to a resolved question channel is rejected with 403;
 *  - a successful post to an open question clears every resolution mark.
 */
@Injectable()
export class QuestionMessagesInterceptor implements NestInterceptor {
  constructor(private readonly questions: ActiveQuestionsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest<Request>();
    if (req.method?.toUpperCase() !== 'POST') return next.handle();
    const match = POST_MESSAGE_PATH.exec((req.originalUrl ?? req.url ?? '').split('?')[0]);
    if (!match) return next.handle();
    const channelId = decodeURIComponent(match[1]);

    return from(this.questions.findChannel(channelId)).pipe(
      switchMap((channel) => {
        if (!channel || channel.kind !== CHANNEL_KIND_QUESTION) return next.handle();
        if (channel.status === QUESTION_STATUS_RESOLVED) {
          throw new ForbiddenException('this question is resolved; no further messages can be posted');
        }
        return next.handle().pipe(
          mergeMap(async (result) => {
            await this.questions.clearResolutions(channelId);
            return result;
          }),
        );
      }),
    );
  }
}
