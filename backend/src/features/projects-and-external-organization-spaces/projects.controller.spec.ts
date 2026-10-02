/**
 * Story: Projects and External Organization Spaces — HTTP layer.
 */
import { BadRequestException, ForbiddenException, HttpStatus } from '@nestjs/common';
import { HTTP_CODE_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import type { Request } from 'express';
import { makeFakePrisma, seed } from './fake-prisma.spec-helper';
import { InvitationMailerService } from './invitation-mailer.service';
import { InvitationsService } from './invitations.service';
import { InvitationsController, ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

async function setup() {
  const { tx, prisma } = makeFakePrisma();
  await seed(tx);
  const projects = new ProjectsService(prisma as never);
  const mailer = new InvitationMailerService();
  jest.spyOn(mailer, 'sendInvitation').mockResolvedValue(undefined);
  const invitations = new InvitationsService(prisma as never, projects, mailer);
  const req = (userId: string) =>
    ({ session: { userId, role: tx.user.rows.find((u) => u.id === userId)!.role, firmId: null } }) as unknown as Request;
  return {
    tx,
    req,
    projects: new ProjectsController(projects, invitations),
    invites: new InvitationsController(projects, invitations),
  };
}

describe('ProjectsController', () => {
  it('routes are mounted under /api', () => {
    expect(Reflect.getMetadata(PATH_METADATA, ProjectsController)).toBe('api/projects');
    expect(Reflect.getMetadata(PATH_METADATA, InvitationsController)).toBe('api/invitations');
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, ProjectsController.prototype.create)).toBe(HttpStatus.CREATED);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, ProjectsController.prototype.archive)).toBe(HttpStatus.OK);
  });

  it('create → get → list round trip', async () => {
    const { req, projects } = await setup();
    const created = await projects.create(req('manager'), { organization_name: 'Globex', organization_type: 'client' });
    expect(created.default_channel_id).toBeTruthy();
    const got = await projects.get(req('manager'), created.id);
    expect(got.organization.name).toBe('Globex');
    const list = await projects.list(req('manager'));
    expect(list).toMatchObject({ page: 1, total: 1 });
  });

  it('employee create → 403 even with an invalid body; blank name → 400', async () => {
    const { tx, req, projects } = await setup();
    await expect(projects.create(req('employee'), {})).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      projects.create(req('manager'), { organization_name: ' ', organization_type: 'vendor' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.projects.rows).toHaveLength(0);
  });

  it('invite + resend through the controllers', async () => {
    const { req, projects, invites } = await setup();
    const p = await projects.create(req('admin'), { organization_name: 'Hooli', organization_type: 'vendor' });
    const inv = await projects.invite(req('admin'), p.id, { email: 'c@hooli.com' });
    expect(inv).toMatchObject({ status: 'pending', delivery: 'sent' });
    const again = await invites.resend(req('admin'), inv.id);
    expect(again.id).toBe(inv.id);
    await expect(projects.invite(req('employee'), p.id, { email: 'c@hooli.com' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('archive is admin-only', async () => {
    const { req, projects } = await setup();
    const p = await projects.create(req('manager'), { organization_name: 'Q', organization_type: 'other' });
    await expect(projects.archive(req('manager'), p.id)).rejects.toBeInstanceOf(ForbiddenException);
    expect(await projects.archive(req('admin'), p.id)).toEqual({ id: p.id, status: 'archived' });
  });
});
