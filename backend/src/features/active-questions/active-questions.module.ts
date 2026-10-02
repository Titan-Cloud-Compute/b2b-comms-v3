import { Module } from '@nestjs/common';
import { ActiveQuestionsService } from './active-questions.service';
import { ProjectQuestionsController } from './active-questions.controller';
import { QuestionsController } from './active-questions.controller';

/** Active Question Chats: /api/projects/:id/questions and /api/questions/:id/resolve. */
@Module({
  controllers: [ProjectQuestionsController, QuestionsController],
  providers: [ActiveQuestionsService],
})
export class ActiveQuestionsModule {}
