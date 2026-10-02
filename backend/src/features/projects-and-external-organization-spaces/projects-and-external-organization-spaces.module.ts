import { Module } from '@nestjs/common';
import { InvitationMailerService } from './invitation-mailer.service';
import { InvitationsService } from './invitations.service';
import { InvitationsController, ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

/**
 * Story: Projects and External Organization Spaces — projects CRUD/archive,
 * membership and external-contact invitations. JwtAuthGuard + RolesGuard are
 * global APP_GUARDs; per-role/organization rules live in ProjectsService.
 */
@Module({
  controllers: [ProjectsController, InvitationsController],
  providers: [ProjectsService, InvitationsService, InvitationMailerService],
})
export class ProjectsAndExternalOrganizationSpacesModule {}
