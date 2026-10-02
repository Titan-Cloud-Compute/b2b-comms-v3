import { Module } from '@nestjs/common';
import { ReferencesController } from './references.controller';
import { ReferencesService } from './references.service';

/**
 * Story: Message Reference and Annotation — annotated PDF/image page
 * references attached to chat messages. MinioService comes from the global
 * IntegrationsModule.
 */
@Module({
  controllers: [ReferencesController],
  providers: [ReferencesService],
  exports: [ReferencesService],
})
export class MessageReferenceAndAnnotationModule {}
