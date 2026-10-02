import {
  CallHandler,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { Observable, from, map, switchMap } from 'rxjs';
import { PrismaService } from '../../prisma/prisma.service';

/** Matches POST /api/channels/:channelId/messages (with optional trailing slash). */
const POST_MESSAGES_RE = /^\/api\/channels\/([^/]+)\/messages\/?$/;

/**
 * Global interceptor that enforces question-channel rules on POST
 * /api/channels/:id/messages requests:
 *
 * - **Resolved question** → 403 ForbiddenException, thrown before the handler
 *   runs.
 * - **Open question** → after the handler succeeds, ALL question_resolutions
 *   rows for the channel are deleted (a new message voids pending resolution
 *   marks from either side). The channel's `status` is left as "open".
 * - **Non-question channel** (kind ≠ 'question', or channel not found) → pass
 *   through unchanged.
 * - **Any other route** → pass through unchanged.
 *
 * Because the global JwtAuthGuard runs before all interceptors, unauthenticated
 * requests still receive 401 and never reach this interceptor.
 */
@Injectable()
export class QuestionMessagesInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<Request>();
    if (req.method !== 'POST') return next.handle();

    const match = POST_MESSAGES_RE.exec(req.path);
    if (!match) return next.handle();

    const channelId = match[1];

    return from(this.loadChannel(channelId)).pipe(
      switchMap((channel) => {
        // Not a question channel → pass through untouched
        if (!channel || channel.kind !== 'question') {
          return next.handle();
        }

        // Resolved question → 403 before the handler runs
        if (channel.status === 'resolved') {
          throw new ForbiddenException('question is resolved');
        }

        // Open question → let the handler run, then clear all resolution marks
        return next.handle().pipe(
          switchMap((response: unknown) =>
            from(
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (this.prisma as any).question_resolutions.deleteMany({
                where: { channel_id: channelId },
              }),
            ).pipe(map(() => response)),
          ),
        );
      }),
    );
  }

  private loadChannel(
    channelId: string,
  ): Promise<{ kind: string; status: string } | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this.prisma as any).channels.findUnique({
      where: { id: channelId },
      select: { kind: true, status: true },
    });
  }
}
