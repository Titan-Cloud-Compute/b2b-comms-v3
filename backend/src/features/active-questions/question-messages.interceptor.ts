import {
  CallHandler,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { Observable, from, switchMap } from 'rxjs';
import { PrismaService } from '../../prisma/prisma.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Matches POST /api/channels/:id/messages (with or without trailing slash). */
const MESSAGES_PATH_RE = /^\/api\/channels\/([^/]+)\/messages\/?$/;

/**
 * Guards POST /api/channels/:id/messages for question channels.
 *
 * Rules (applied after JwtAuthGuard so 401 takes precedence over 403):
 *  - Non-matching paths or non-POST methods: pass through untouched.
 *  - Channel does not exist or kind !== 'question': pass through untouched.
 *  - status === 'resolved': throw 403 ForbiddenException immediately.
 *  - Otherwise: let the handler run, then wipe all question_resolutions rows
 *    for this channel (a new message clears any partial resolution marks).
 *
 * Registered in ActiveQuestionsModule as APP_INTERCEPTOR so it is applied
 * globally. Interceptors run after guards, so the real JwtAuthGuard always
 * validates the session before this code fires.
 */
@Injectable()
export class QuestionMessagesInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<Request>();

    // Only intercept POST to /api/channels/:id/messages
    if (req.method !== 'POST') return next.handle();
    const match = MESSAGES_PATH_RE.exec(req.path);
    if (!match) return next.handle();

    const channelId = match[1];
    return from(this.check(channelId)).pipe(
      switchMap((shouldClear) => {
        if (!shouldClear) return next.handle();
        // Handler succeeded → clear resolution marks
        return next.handle().pipe(
          switchMap((response) =>
            from(
              (this.prisma as any).question_resolutions.deleteMany({
                where: { channel_id: channelId },
              }),
            ).pipe(
              switchMap(() => from(Promise.resolve(response))),
            ),
          ),
        );
      }),
    );
  }

  /**
   * Returns:
   *   false  — channel missing or not a question; pass through as-is
   *   true   — open question; let handler run then clear resolution rows
   * Throws ForbiddenException — question is already resolved; block the post.
   */
  private async check(channelId: string): Promise<boolean> {
    const db = this.prisma as any;
    const channel = await db.channels.findUnique({
      where: { id: channelId },
      select: { kind: true, status: true },
    });
    if (!channel || channel.kind !== 'question') return false;
    if (channel.status === 'resolved') {
      throw new ForbiddenException('question is resolved');
    }
    return true;
  }
}
