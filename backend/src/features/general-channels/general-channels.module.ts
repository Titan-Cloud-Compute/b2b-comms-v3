import { Module } from '@nestjs/common';
import { GeneralChannelsController } from './general-channels.controller';
import { GeneralChannelsService } from './general-channels.service';
import { RealtimeHubService } from './realtime-hub.service';

/**
 * Story: General Channels — channels, rich-text messages and the realtime
 * stream (GET /api/realtime/socket, Server-Sent Events). JwtAuthGuard is a
 * global APP_GUARD (401); the service also rejects session-less requests.
 */
@Module({
  controllers: [GeneralChannelsController],
  providers: [GeneralChannelsService, RealtimeHubService],
  exports: [GeneralChannelsService, RealtimeHubService],
})
export class GeneralChannelsModule {}
