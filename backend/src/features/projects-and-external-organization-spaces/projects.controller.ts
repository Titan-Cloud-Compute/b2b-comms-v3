import {
  BadRequestException,
  Body,
  ForbiddenException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import { InvitationsService } from './invitations.service';
import { Actor, ORGANIZATION_TYPES, ProjectsService, canManage } from './projects.service';

const CreateProjectSchema = z.object({
  organization_name: z.string().trim().min(1, 'must not be blank').max(200),
  organization_type: z.enum(ORGANIZATION_TYPES),
  name: z.string().trim().max(200).optional(),
});

const UpdateProjectSchema = z.object({
  name: z.string().trim().min(1, 'must not be blank').max(200).optional(),
});

const AddMemberSchema = z.object({ user_id: z.string().trim().min(1) });

const InviteSchema = z.object({ email: z.string().trim().email() });

export function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body ?? {});
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue?.path.join('.') || 'body';
    throw new BadRequestException(`${field}: ${issue?.message ?? 'invalid'}`);
  }
  return result.data;
}

function requireManager(actor: Actor, what: string): void {
  if (!canManage(actor)) throw new ForbiddenException(`Only managers and admins can ${what}`);
}

@ApiTags('projects')
@Controller('api/projects')
export class ProjectsController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly invitations: InvitationsService,
  ) {}

  @Get()
  async list(
    @Req() req: Request,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('include_archived') includeArchived?: string,
  ) {
    const actor = await this.projects.resolveActor(req.session);
    const p = Math.max(1, Number.parseInt(page ?? '1', 10) || 1);
    const size = Math.min(100, Math.max(1, Number.parseInt(pageSize ?? '25', 10) || 25));
    return this.projects.list(actor, p, size, includeArchived === 'true');
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Req() req: Request, @Body() body: unknown) {
    const actor = await this.projects.resolveActor(req.session);
    // Role check precedes validation so employees always get 403.
    requireManager(actor, 'create projects');
    return this.projects.create(actor, parse(CreateProjectSchema, body));
  }

  @Get(':id')
  async get(@Req() req: Request, @Param('id') id: string) {
    return this.projects.get(await this.projects.resolveActor(req.session), id);
  }

  @Patch(':id')
  async update(@Req() req: Request, @Param('id') id: string, @Body() body: unknown) {
    const actor = await this.projects.resolveActor(req.session);
    return this.projects.update(actor, id, parse(UpdateProjectSchema, body));
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  async archive(@Req() req: Request, @Param('id') id: string) {
    return this.projects.archive(await this.projects.resolveActor(req.session), id);
  }

  @Post(':id/members')
  @HttpCode(HttpStatus.CREATED)
  async addMember(@Req() req: Request, @Param('id') id: string, @Body() body: unknown) {
    const actor = await this.projects.resolveActor(req.session);
    return this.projects.addMember(actor, id, parse(AddMemberSchema, body).user_id);
  }

  @Post(':id/invitations')
  @HttpCode(HttpStatus.CREATED)
  async invite(@Req() req: Request, @Param('id') id: string, @Body() body: unknown) {
    const actor = await this.projects.resolveActor(req.session);
    requireManager(actor, 'invite contacts');
    return this.invitations.invite(actor, id, parse(InviteSchema, body).email);
  }
}

@ApiTags('invitations')
@Controller('api/invitations')
export class InvitationsController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly invitations: InvitationsService,
  ) {}

  @Post(':id/resend')
  @HttpCode(HttpStatus.OK)
  async resend(@Req() req: Request, @Param('id') id: string) {
    return this.invitations.resend(await this.projects.resolveActor(req.session), id);
  }
}
