import { Module } from '@nestjs/common';
import {
  InvitationsAcceptController,
  UsersAdminController,
} from './authentication-and-roles.controller';
import { AuthenticationAndRolesService } from './authentication-and-roles.service';

/**
 * Story: Authentication and Roles — admin user management (/api/users) and
 * invitation acceptance (/api/invitations/accept). Login/logout live in the
 * foundation AuthModule; JwtAuthGuard + RolesGuard are global APP_GUARDs.
 */
@Module({
  controllers: [UsersAdminController, InvitationsAcceptController],
  providers: [AuthenticationAndRolesService],
})
export class AuthenticationAndRolesModule {}
