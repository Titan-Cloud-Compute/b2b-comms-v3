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
import { assertActiveUser, toIdentity } from '../auth/auth-identity';
import { UsersService } from './users.service';

@ApiTags('users')
@UseGuards(JwtAuthGuard)
@Controller('api/users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  /** The signed-in user's real identity; the web authGuard checks the session here. */
  @Get('me')
  async getMe(@Req() req: Request) {
    // JwtAuthGuard attaches the decoded cookie payload as req.session; accept
    // the passport-style req.user shape too so /me never 401s a live session.
    const anyReq = req as unknown as {
      session?: { userId?: string; sub?: string; id?: string };
      user?: { userId?: string; sub?: string; id?: string };
    };
    const userId =
      anyReq.session?.userId ??
      anyReq.session?.sub ??
      anyReq.session?.id ??
      anyReq.user?.userId ??
      anyReq.user?.sub ??
      anyReq.user?.id;
    if (!userId) throw new UnauthorizedException();
    const user = await this.users.findById(userId);
    if (!user) throw new UnauthorizedException();
    assertActiveUser(user);
    return toIdentity(user);
  }
}

export class UserNotificationPreferencesController {}
