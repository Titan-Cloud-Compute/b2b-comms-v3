import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ProjectsModule } from '../projects/projects.module';
import { ActiveQuestionsController } from './active-questions.controller';
import { ActiveQuestionsService } from './active-questions.service';
import { QuestionMessagesInterceptor } from './question-messages.interceptor';

/** Active Questions: question channels, two-sided resolution, and the message-post hook. */
@Module({
  imports: [ProjectsModule],
  controllers: [ActiveQuestionsController],
  providers: [
    ActiveQuestionsService,
    QuestionMessagesInterceptor,
    { provide: APP_INTERCEPTOR, useExisting: QuestionMessagesInterceptor },
  ],
  exports: [ActiveQuestionsService],
})
export class ActiveQuestionsModule {}
