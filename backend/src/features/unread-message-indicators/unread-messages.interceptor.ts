import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, from, mergeMap } from 'rxjs';
import { messagePostTarget } from './unread-message-indicators.logic';
import { UnreadMessageIndicatorsService } from './unread-message-indicators.service';

/**
 * Global hook on `POST /api/channels/:id/messages` (owned by General Channels):
 * after a successful post, increments the other members' unread counts and
 * emits unread.changed to each of them. Failures never break the post.
 */
@Injectable()
export class UnreadMessagesInterceptor implements NestInterceptor {
  constructor(private readonly svc: UnreadMessageIndicatorsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest();
    const channelId = messagePostTarget(req);
    const authorId: string | undefined = req?.session?.userId;
    if (!channelId || !authorId) return next.handle();
    return next.handle().pipe(
      mergeMap((result) =>
        from(
          this.svc
            .onMessagePosted(channelId, authorId)
            .catch(() => undefined)
            .then(() => result),
        ),
      ),
    );
  }
}
