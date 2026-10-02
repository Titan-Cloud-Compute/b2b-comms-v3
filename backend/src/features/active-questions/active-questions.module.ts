import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ActiveQuestionsService } from './active-questions.service';
import { ProjectQuestionsController } from './active-questions.controller';
import { QuestionsController } from './active-questions.controller';
import { QuestionMessagesInterceptor } from './question-messages.interceptor';

/** Active Question Chats: /api/projects/:id/questions and /api/questions/:id/resolve. */
@Module({
  controllers: [ProjectQuestionsController, QuestionsController],
  providers: [
    ActiveQuestionsService,
    { provide: APP_INTERCEPTOR, useClass: QuestionMessagesInterceptor },
  ],
})
export class ActiveQuestionsModule {}
