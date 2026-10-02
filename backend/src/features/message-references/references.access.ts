import { ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Asserts the calling user is a member of the given project.
 * Throws 403 ForbiddenException when:
 *  - No project_members row exists for (projectId, userId)
 *  - The channel is internal_only and the user's organization is not is_internal
 *    (pass channelInternalOnly=true and userOrgIsInternal=false to trigger this)
 */
export async function assertProjectMember(
  prisma: PrismaService,
  userId: string,
  projectId: string,
  opts?: { channelInternalOnly?: boolean; userOrgIsInternal?: boolean },
): Promise<void> {
  const member: any = await (prisma as any).project_members.findFirst({
    where: { project_id: projectId, user_id: userId },
  });
  if (!member) {
    throw new ForbiddenException('not a project member');
  }
  if (opts?.channelInternalOnly && !opts.userOrgIsInternal) {
    throw new ForbiddenException('not authorised to view this channel');
  }
}
