import { Module } from '@nestjs/common';
import { ActiveQuestionsService } from './active-questions.service';
import { ProjectQuestionsController } from './active-questions.controller';
import { QuestionsController } from './active-questions.controller';

/**
 * Active Questions feature module.
 *
 * Exposes:
 *   GET/POST /api/projects/:id/questions
 *   POST/DELETE /api/questions/:id/resolve
 *
 * PrismaService is provided by the global PrismaModule (registered in AppModule).
 * JwtAuthGuard is provided globally by AuthModule via APP_GUARD.
 */
@Module({
  controllers: [ProjectQuestionsController, QuestionsController],
  providers: [ActiveQuestionsService],
})
export class ActiveQuestionsModule {}
