import {
  Controller,
  Get,
  NotFoundException,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { toIdentity } from '../auth/auth.controller';
import { UsersService } from './users.service';

@ApiTags('users')
@UseGuards(JwtAuthGuard)
@Controller('api/users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  /** The signed-in user's real identity (same shape as /api/auth/me). */
  @Get('me')
  async getMe(@Req() req: Request) {
    const userId = req.session?.userId;
    const user = userId ? await this.users.findSessionUser(userId) : null;
    if (!user) throw new NotFoundException('user not found');
    return toIdentity(user);
  }
}

export class UserNotificationPreferencesController {}
