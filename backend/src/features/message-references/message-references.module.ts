import { Module } from '@nestjs/common';
import { ReferencesController } from './references.controller';
import { ReferencesService } from './references.service';
import { FilePagesController } from './page-render/file-pages.controller';
import { PageRenderService } from './page-render/page-render.service';

/** Message References: create, view, update and delete file page references on messages. */
@Module({
  controllers: [ReferencesController, FilePagesController],
  providers: [ReferencesService, PageRenderService],
  exports: [ReferencesService],
})
export class MessageReferencesModule {}
