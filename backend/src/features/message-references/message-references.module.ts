import { Module } from '@nestjs/common';
import { FilePagesController } from './page-render/file-pages.controller';
import { PageRenderService } from './page-render/page-render.service';
import { ReferencesController } from './references.controller';
import { ReferencesService } from './references.service';

/** Message Reference and Annotation feature module. */
@Module({
  controllers: [ReferencesController, FilePagesController],
  providers: [ReferencesService, PageRenderService],
  exports: [ReferencesService, PageRenderService],
})
export class MessageReferencesModule {}
