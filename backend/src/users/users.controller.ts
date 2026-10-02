import {
  Controller,
  Get,
  NotFoundException,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { toAuthUserProfile } from '../auth/auth.controller';
import { ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UsersService } from './users.service';

@ApiTags('users')
@UseGuards(JwtAuthGuard)
@Controller('api/users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  async getMe(@Req() req: Request) {
    const user = await this.users.findById(req.session!.userId);
    if (!user) throw new NotFoundException('user not found');
    return toAuthUserProfile(user);
  }
}

export class UserNotificationPreferencesController {}
