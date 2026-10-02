import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UsersService } from './users.service';
import { assertActiveUser, toIdentity } from '../auth/auth-identity';

@ApiTags('users')
@UseGuards(JwtAuthGuard)
@Controller('api/users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  /**
   * Return the identity of the currently authenticated user.
   *
   * Guards are responsible for populating req.session, but we defensively
   * check for a missing userId so a misconfigured or bypassed guard never
   * leaks a 500 — it gets a clean 401 instead.
   *
   * Deactivated accounts are refused here so that disabling a user also
   * terminates any live session on the next /me poll (the front-end calls
   * this on each session start).
   */
  @Get('me')
  @HttpCode(HttpStatus.OK)
  async getMe(@Req() req: Request) {
    const userId = req.session?.userId;
    if (!userId) throw new UnauthorizedException('not authenticated');
    const user = await this.users.findById(userId);
    if (!user) throw new UnauthorizedException('invalid credentials');
    assertActiveUser(user);
    return toIdentity(user);
  }
}

export class UserNotificationPreferencesController {}
