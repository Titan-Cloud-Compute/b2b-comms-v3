import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import type { z, ZodTypeAny } from 'zod';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { ProjectsService } from './projects.service';
import {
  addMemberSchema,
  canCreateProject,
  createProjectSchema,
  listQuerySchema,
  updateProjectSchema,
} from './projects.policy';

function parse<S extends ZodTypeAny>(schema: S, value: unknown): z.output<S> {
  const r = schema.safeParse(value ?? {});
  if (!r.success) {
    throw new BadRequestException(
      r.error.issues.map((i: { message: string }) => i.message).join('; ') || 'invalid request',
    );
  }
  return r.data as z.output<S>;
}

@UseGuards(JwtAuthGuard)
@Controller('api/projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  private async actor(req: Request) {
    if (!req.session) throw new UnauthorizedException('not authenticated');
    return this.projects.resolveActor(req.session);
  }

  @Get()
  async list(@Req() req: Request, @Query() query: unknown) {
    const actor = await this.actor(req);
    return this.projects.list(actor, parse(listQuerySchema, query));
  }

  @Post()
  @HttpCode(201)
  async create(@Req() req: Request, @Body() body: unknown) {
    const actor = await this.actor(req);
    // Role gate first so Employees get 403 regardless of body shape.
    if (!canCreateProject(actor)) {
      throw new ForbiddenException('only managers and admins can create projects');
    }
    return this.projects.create(actor, parse(createProjectSchema, body));
  }

  @Get(':id')
  async get(@Req() req: Request, @Param('id') id: string) {
    return this.projects.get(await this.actor(req), id);
  }

  @Patch(':id')
  async update(@Req() req: Request, @Param('id') id: string, @Body() body: unknown) {
    return this.projects.update(await this.actor(req), id, parse(updateProjectSchema, body));
  }

  @Post(':id/archive')
  @HttpCode(200)
  async archive(@Req() req: Request, @Param('id') id: string) {
    return this.projects.archive(await this.actor(req), id);
  }

  @Post(':id/members')
  @HttpCode(201)
  async addMember(@Req() req: Request, @Param('id') id: string, @Body() body: unknown) {
    return this.projects.addMember(await this.actor(req), id, parse(addMemberSchema, body));
  }
}
