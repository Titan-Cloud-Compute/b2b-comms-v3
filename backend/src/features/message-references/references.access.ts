import { ForbiddenException } from '@nestjs/common';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Assert that `userId` is a member of `projectId`.
 * Throws 403 ForbiddenException when no project_members row is found.
 */
export async function assertProjectMember(
  prisma: any,
  userId: string,
  projectId: string,
): Promise<void> {
  const row = await (prisma as any).project_members.findFirst({
    where: { project_id: projectId, user_id: userId },
  });
  if (!row) {
    throw new ForbiddenException('you are not a member of this project');
  }
}
