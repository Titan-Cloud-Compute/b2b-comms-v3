import {
  Controller,
  Get,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { toIdentity } from '../auth/auth.service';
import { UsersService } from './users.service';

@ApiTags('users')
@UseGuards(JwtAuthGuard)
@Controller('api/users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  /** The real signed-in identity (role + organization) from the users table. */
  @Get('me')
  async getMe(@Req() req: Request) {
    const userId = req.session?.userId;
    if (!userId) throw new UnauthorizedException('not authenticated');
    const user = await this.users.findById(userId);
    if (!user || user.active === false) {
      throw new UnauthorizedException('not authenticated');
    }
    return toIdentity(user);
  }
}

export class UserNotificationPreferencesController {}
