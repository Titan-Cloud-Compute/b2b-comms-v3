/**
 * Story: Projects and External Organization Spaces — invitations + delivery.
 */
import { ForbiddenException } from '@nestjs/common';
import { makeFakePrisma, seed } from './fake-prisma.spec-helper';
import { InvitationMailerService } from './invitation-mailer.service';
import { InvitationsService } from './invitations.service';
import { ProjectsService } from './projects.service';

async function setup(mailerImpl?: () => Promise<void>) {
  const { tx, prisma } = makeFakePrisma();
  await seed(tx);
  const projects = new ProjectsService(prisma as never);
  const mailer = new InvitationMailerService();
  const send = jest.spyOn(mailer, 'sendInvitation').mockImplementation(mailerImpl ?? (async () => undefined));
  const service = new InvitationsService(prisma as never, projects, mailer);
  const actor = (userId: string) =>
    projects.resolveActor({ userId, role: tx.user.rows.find((u) => u.id === userId)!.role });
  const project = await projects.create(await actor('manager'), { organization_name: 'Globex', organization_type: 'vendor' });
  return { tx, service, actor, project, send };
}

describe('InvitationsService', () => {
  it('stores a pending invitation and sends the email', async () => {
    const { tx, service, actor, project, send } = await setup();
    const res = await service.invite(await actor('manager'), project.id, 'Contact@Globex.com');
    expect(res).toMatchObject({ project_id: project.id, email: 'contact@globex.com', status: 'pending', delivery: 'sent' });
    expect(new Date(res.expires_at).getTime()).toBeGreaterThan(Date.now());
    expect(tx.invitations.rows).toHaveLength(1);
    expect(tx.invitations.rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('relay down: still 201-style result with delivery failed and a pending row; resend works', async () => {
    let down = true;
    const { tx, service, actor, project } = await setup(async () => {
      if (down) throw new Error('relay down');
    });
    const mgr = await actor('manager');
    const res = await service.invite(mgr, project.id, 'x@y.com');
    expect(res.delivery).toBe('failed');
    expect(tx.invitations.rows[0].status).toBe('pending');
    down = false;
    const again = await service.resend(mgr, res.id);
    expect(again).toMatchObject({ id: res.id, status: 'pending', delivery: 'sent' });
  });

  it('employees and external users cannot invite (403, no row)', async () => {
    const { tx, service, actor, project } = await setup();
    await expect(service.invite(await actor('employee'), project.id, 'a@b.com')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.invite(await actor('extA'), project.id, 'a@b.com')).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.invitations.rows).toHaveLength(0);
  });
});
