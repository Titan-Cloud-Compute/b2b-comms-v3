import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ActiveQuestionsService } from './active-questions.service';
import { ProjectQuestionsController } from './active-questions.controller';
import { QuestionsController } from './active-questions.controller';
import { QuestionMessagesInterceptor } from './question-messages.interceptor';

/**
 * Active Questions feature module.
 *
 * Exposes:
 *   GET/POST /api/projects/:id/questions
 *   POST/DELETE /api/questions/:id/resolve
 *
 * PrismaService is provided by the global PrismaModule (registered in AppModule).
 * JwtAuthGuard is provided globally by AuthModule via APP_GUARD.
 *
 * QuestionMessagesInterceptor is registered as a global APP_INTERCEPTOR so it
 * guards POST /api/channels/:id/messages for question channels: it returns 403
 * when the question is resolved, and clears question_resolutions rows after a
 * successful post to an open question.
 */
@Module({
  controllers: [ProjectQuestionsController, QuestionsController],
  providers: [
    ActiveQuestionsService,
    { provide: APP_INTERCEPTOR, useClass: QuestionMessagesInterceptor },
  ],
})
export class ActiveQuestionsModule {}
