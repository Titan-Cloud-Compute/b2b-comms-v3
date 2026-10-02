import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ActiveQuestionChatsController } from './active-question-chats.controller';
import { ActiveQuestionChatsService } from './active-question-chats.service';
import { QuestionMessagesInterceptor } from './question-messages.interceptor';

/**
 * Story: Active Question Chats — question channels with two-party resolution.
 * The APP_INTERCEPTOR hooks POST /api/channels/:id/messages (owned by General
 * Channels) to block posts to resolved questions and clear resolution marks.
 */
@Module({
  controllers: [ActiveQuestionChatsController],
  providers: [
    ActiveQuestionChatsService,
    { provide: APP_INTERCEPTOR, useClass: QuestionMessagesInterceptor },
  ],
  exports: [ActiveQuestionChatsService],
})
export class ActiveQuestionChatsModule {}
