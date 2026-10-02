import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { matchUnreadRequest } from './unread-message-indicators.logic';
import { UnreadMessageIndicatorsService } from './unread-message-indicators.service';

/**
 * Observes the General Channels message endpoints (without editing that feature):
 * a successful POST /api/channels/:id/messages increments other members' unread_count,
 * a successful first-page GET /api/channels/:id/messages marks the channel read for the viewer.
 * Side effects are best-effort and never change the original response.
 */
@Injectable()
export class UnreadMessageIndicatorsInterceptor implements NestInterceptor {
  private readonly log = new Logger('UnreadMessageIndicators');

  constructor(private readonly svc: UnreadMessageIndicatorsService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const req = ctx.switchToHttp().getRequest<any>();
    const match = matchUnreadRequest(req?.method, req?.originalUrl ?? req?.url);
    const userId: string | undefined = req?.session?.userId;
    if (!match || !userId) return next.handle();
    return next.handle().pipe(
      tap(() => {
        const work =
          match.kind === 'post' ? this.svc.onMessagePosted(match.channelId, userId) : this.svc.resetFor(match.channelId, userId);
        work.catch((err: unknown) => this.log.warn(`unread update failed: ${(err as Error)?.message ?? err}`));
      }),
    );
  }
}
