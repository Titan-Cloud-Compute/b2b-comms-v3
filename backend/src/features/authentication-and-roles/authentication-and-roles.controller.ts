import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { Public } from '../../auth/decorators/public.decorator';
import { RequireAdmin } from '../../auth/roles.guard';
import { AuthenticationAndRolesService, USER_ROLES } from './authentication-and-roles.service';

const CreateUserSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8),
  display_name: z.string().trim().min(1).max(120).optional(),
  role: z.enum(USER_ROLES),
  organization_id: z.string().min(1).nullable().optional(),
});

const UpdateUserSchema = z.object({
  email: z.string().trim().email().optional(),
  display_name: z.string().trim().min(1).max(120).optional(),
  role: z.enum(USER_ROLES).optional(),
  active: z.boolean().optional(),
  organization_id: z.string().min(1).nullable().optional(),
});

const AcceptInvitationSchema = z.object({
  token: z.string().trim().min(1),
  display_name: z.string().trim().min(1).max(120),
  password: z.string().min(8),
});

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body ?? {});
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue?.path.join('.') || 'body';
    throw new BadRequestException(`${field}: ${issue?.message ?? 'invalid'}`);
  }
  return result.data;
}

/** Admin-only user administration. Other roles get 403 from RolesGuard. */
@ApiTags('users')
@RequireAdmin()
@Controller('api/users')
export class UsersAdminController {
  constructor(private readonly service: AuthenticationAndRolesService) {}

  @Get()
  list(@Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    const p = Math.max(1, Number.parseInt(page ?? '1', 10) || 1);
    const size = Math.min(100, Math.max(1, Number.parseInt(pageSize ?? '50', 10) || 50));
    return this.service.listUsers(p, size);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() body: unknown) {
    return this.service.createUser(parse(CreateUserSchema, body));
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: unknown) {
    return this.service.updateUser(id, parse(UpdateUserSchema, body));
  }
}

/** Public: invited contacts have no session yet. */
@ApiTags('invitations')
@Controller('api/invitations')
export class InvitationsAcceptController {
  constructor(private readonly service: AuthenticationAndRolesService) {}

  @Public()
  @Post('accept')
  @HttpCode(HttpStatus.CREATED)
  accept(@Body() body: unknown) {
    return this.service.acceptInvitation(parse(AcceptInvitationSchema, body));
  }
}
