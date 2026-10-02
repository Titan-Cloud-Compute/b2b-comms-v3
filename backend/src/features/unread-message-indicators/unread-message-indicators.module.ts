import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { GeneralChannelsModule } from '../general-channels/general-channels.module';
import { UnreadMessageIndicatorsController } from './unread-message-indicators.controller';
import { UnreadMessageIndicatorsInterceptor } from './unread-message-indicators.interceptor';
import { UnreadMessageIndicatorsService } from './unread-message-indicators.service';

/**
 * Story: Unread Message Indicators — GET /api/projects/:id/unread, POST /api/channels/:id/read,
 * and an interceptor that keeps channel_read_state in step with General Channels posts/views and
 * publishes `unread.changed` on the shared realtime hub (GET /api/realtime/socket).
 */
@Module({
  imports: [GeneralChannelsModule],
  controllers: [UnreadMessageIndicatorsController],
  providers: [
    UnreadMessageIndicatorsService,
    UnreadMessageIndicatorsInterceptor,
    { provide: APP_INTERCEPTOR, useExisting: UnreadMessageIndicatorsInterceptor },
  ],
})
export class UnreadMessageIndicatorsModule {}
