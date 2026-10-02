import { Module } from '@nestjs/common';
import { MessageReferencesController, ReferencesController } from './references.controller';
import { ReferencesService } from './references.service';
import { PageRenderController } from './page-render/page-render.controller';
import { PageRenderService } from './page-render/page-render.service';

@Module({
  controllers: [MessageReferencesController, ReferencesController, PageRenderController],
  providers: [ReferencesService, PageRenderService],
  exports: [ReferencesService],
})
export class MessageReferencesModule {}
