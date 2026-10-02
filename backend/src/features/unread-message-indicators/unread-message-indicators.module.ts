import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { GeneralChannelsModule } from '../general-channels/general-channels.module';
import { UnreadHubService } from './unread-hub.service';
import { UnreadMessageIndicatorsController } from './unread-message-indicators.controller';
import { UnreadMessageIndicatorsService } from './unread-message-indicators.service';
import { UnreadMessagesInterceptor } from './unread-messages.interceptor';

/**
 * Story: Unread Message Indicators — GET /api/projects/:id/unread,
 * POST /api/channels/:id/read, GET /api/realtime/unread (per-user SSE of
 * unread.changed) and a write-path hook on message posts.
 */
@Module({
  imports: [GeneralChannelsModule],
  controllers: [UnreadMessageIndicatorsController],
  providers: [
    UnreadMessageIndicatorsService,
    UnreadHubService,
    { provide: APP_INTERCEPTOR, useClass: UnreadMessagesInterceptor },
  ],
  exports: [UnreadMessageIndicatorsService],
})
export class UnreadMessageIndicatorsModule {}
