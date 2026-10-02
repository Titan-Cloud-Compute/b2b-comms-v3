import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { ProjectsService } from '../projects/projects.service';
import { createQuestionSchema } from './active-questions.policy';
import { ActiveQuestionsService } from './active-questions.service';

/**
 * Active Questions HTTP surface:
 *   GET/POST /api/projects/:id/questions
 *   GET /api/questions/:id
 *   POST/DELETE /api/questions/:id/resolve
 * Thread messages use the General Channels routes (/api/channels/:id/messages).
 */
@UseGuards(JwtAuthGuard)
@Controller('api')
export class ActiveQuestionsController {
  constructor(
    private readonly questions: ActiveQuestionsService,
    private readonly projects: ProjectsService,
  ) {}

  private async actor(req: Request) {
    if (!req.session) throw new UnauthorizedException('not authenticated');
    return this.projects.resolveActor(req.session);
  }

  @Get('projects/:id/questions')
  async list(@Req() req: Request, @Param('id') id: string) {
    return this.questions.list(await this.actor(req), id);
  }

  @Post('projects/:id/questions')
  @HttpCode(201)
  async create(@Req() req: Request, @Param('id') id: string, @Body() body: unknown) {
    const actor = await this.actor(req);
    const r = createQuestionSchema.safeParse(body ?? {});
    if (!r.success) {
      throw new BadRequestException(r.error.issues.map((i) => i.message).join('; ') || 'invalid request');
    }
    return this.questions.create(actor, id, r.data);
  }

  @Get('questions/:id')
  async get(@Req() req: Request, @Param('id') id: string) {
    return this.questions.get(await this.actor(req), id);
  }

  @Post('questions/:id/resolve')
  @HttpCode(200)
  async resolve(@Req() req: Request, @Param('id') id: string) {
    return this.questions.resolve(await this.actor(req), id);
  }

  @Delete('questions/:id/resolve')
  @HttpCode(200)
  async withdraw(@Req() req: Request, @Param('id') id: string) {
    return this.questions.withdraw(await this.actor(req), id);
  }
}
