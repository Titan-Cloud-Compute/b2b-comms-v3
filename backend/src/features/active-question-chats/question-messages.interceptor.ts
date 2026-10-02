import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, from, mergeMap, of, switchMap } from 'rxjs';
import { ActiveQuestionChatsService } from './active-question-chats.service';

const MESSAGE_POST = /^\/api\/channels\/([^/?#]+)\/messages\/?$/;

/** Extracts the channel id from a `POST /api/channels/:id/messages` request, else null. */
export function questionMessageTarget(req: { method?: string; originalUrl?: string; url?: string }): string | null {
  if (String(req?.method ?? '').toUpperCase() !== 'POST') return null;
  const path = String(req.originalUrl ?? req.url ?? '').split('?')[0];
  const m = MESSAGE_POST.exec(path);
  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * Global hook on message posts: a resolved question rejects new messages
 * (403), and a new message in an open question clears its resolution marks.
 */
@Injectable()
export class QuestionMessagesInterceptor implements NestInterceptor {
  constructor(private readonly svc: ActiveQuestionChatsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest();
    const channelId = questionMessageTarget(req);
    if (!channelId || !req?.session?.userId) return next.handle();
    return from(this.svc.assertCanPost(channelId)).pipe(
      switchMap((isQuestion) =>
        next.handle().pipe(
          mergeMap((result) =>
            isQuestion ? from(this.svc.clearResolutions(channelId).then(() => result)) : of(result),
          ),
        ),
      ),
    );
  }
}
