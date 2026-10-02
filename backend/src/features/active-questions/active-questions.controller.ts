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
 * Handles GET and POST /api/projects/:id/questions.
 * Auth is enforced by the global APP_GUARD (JwtAuthGuard) — no @UseGuards needed.
 */
@Controller('api/projects/:id/questions')
export class ProjectQuestionsController {
  constructor(private readonly service: ActiveQuestionsService) {}

  @Get()
  async listQuestions(@Req() req: Request, @Param('id') id: string) {
    if (!req.session) throw new UnauthorizedException('not authenticated');
    return this.service.listQuestions(id, req.session.userId);
  }

  @Post()
  @HttpCode(201)
  async createQuestion(@Req() req: Request, @Param('id') id: string, @Body() body: unknown) {
    if (!req.session) throw new UnauthorizedException('not authenticated');
    return this.service.createQuestion(id, req.session.userId, body);
  }
}

/**
 * Handles POST and DELETE /api/questions/:id/resolve.
 * Auth is enforced by the global APP_GUARD (JwtAuthGuard).
 */
@Controller('api/questions')
export class QuestionsController {
  constructor(private readonly service: ActiveQuestionsService) {}

  @Post(':id/resolve')
  @HttpCode(200)
  async resolve(@Req() req: Request, @Param('id') id: string) {
    if (!req.session) throw new UnauthorizedException('not authenticated');
    return this.service.resolve(id, req.session.userId);
  }

  @Delete(':id/resolve')
  @HttpCode(200)
  async withdraw(@Req() req: Request, @Param('id') id: string) {
    if (!req.session) throw new UnauthorizedException('not authenticated');
    return this.service.withdraw(id, req.session.userId);
  }
}
