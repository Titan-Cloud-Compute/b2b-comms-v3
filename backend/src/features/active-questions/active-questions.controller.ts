import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { ActiveQuestionsService } from './active-questions.service';

/**
 * Handles listing and creating active questions within a project.
 *
 * GET  /api/projects/:id/questions  — list all questions for the project
 * POST /api/projects/:id/questions  — create a new question (returns 201)
 *
 * Auth is enforced by the global APP_GUARD (JwtAuthGuard). Never uses @Public().
 */
@Controller('api/projects/:id/questions')
export class ProjectQuestionsController {
  constructor(private readonly questions: ActiveQuestionsService) {}

  private userId(req: Request): string {
    if (!req.session?.userId) throw new UnauthorizedException('not authenticated');
    return req.session.userId;
  }

  @Get()
  async listQuestions(@Req() req: Request, @Param('id') projectId: string) {
    return this.questions.listQuestions(projectId, this.userId(req));
  }

  @Post()
  async createQuestion(
    @Req() req: Request,
    @Param('id') projectId: string,
    @Body() body: unknown,
  ) {
    return this.questions.createQuestion(projectId, this.userId(req), body);
  }
}

/**
 * Handles resolve / withdraw operations on individual questions.
 *
 * POST   /api/questions/:id/resolve  — mark this side as resolved (200)
 * DELETE /api/questions/:id/resolve  — withdraw this side's resolution (200)
 *
 * Auth is enforced by the global APP_GUARD (JwtAuthGuard). Never uses @Public().
 */
@Controller('api/questions')
export class QuestionsController {
  constructor(private readonly questions: ActiveQuestionsService) {}

  private userId(req: Request): string {
    if (!req.session?.userId) throw new UnauthorizedException('not authenticated');
    return req.session.userId;
  }

  @Post(':id/resolve')
  @HttpCode(200)
  async resolve(@Req() req: Request, @Param('id') channelId: string) {
    return this.questions.resolve(channelId, this.userId(req));
  }

  @Delete(':id/resolve')
  @HttpCode(200)
  async withdraw(@Req() req: Request, @Param('id') channelId: string) {
    return this.questions.withdraw(channelId, this.userId(req));
  }
}
