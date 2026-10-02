import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { GeneralChannelsController } from './general-channels.controller';
import { GeneralChannelsService } from './general-channels.service';
import { RealtimeHub } from './realtime.hub';

/** General Channels: channels, messages and the realtime event stream. */
@Module({
  imports: [ProjectsModule],
  controllers: [GeneralChannelsController],
  providers: [GeneralChannelsService, RealtimeHub],
  exports: [GeneralChannelsService, RealtimeHub],
})
export class GeneralChannelsModule {}
