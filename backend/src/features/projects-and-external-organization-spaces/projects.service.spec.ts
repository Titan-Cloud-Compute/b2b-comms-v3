/**
 * Story: Projects and External Organization Spaces — service + access policy.
 * Prisma is replaced by an in-memory fake; no database is needed.
 */
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { makeFakePrisma, seed } from './fake-prisma.spec-helper';
import { ProjectsService } from './projects.service';

async function setup() {
  const { tx, prisma } = makeFakePrisma();
  const orgs = await seed(tx);
  const service = new ProjectsService(prisma as never);
  const actor = (userId: string) => service.resolveActor({ userId, role: tx.user.rows.find((u) => u.id === userId)!.role });
  return { tx, service, actor, orgs };
}

describe('ProjectsService', () => {
  it('manager creates a project with org, membership and default channel', async () => {
    const { tx, service, actor } = await setup();
    const res = await service.create(await actor('manager'), {
      organization_name: '  Globex ',
      organization_type: 'customer',
    });
    expect(res.name).toBe('Globex');
    expect(res.status).toBe('active');
    expect(res.organization).toMatchObject({ name: 'Globex', type: 'customer' });
    expect(res.default_channel_id).toBeTruthy();
    expect(tx.projects.rows).toHaveLength(1);
    expect(tx.organizations.rows.find((o) => o.name === 'Globex')?.is_internal).toBe(false);
    expect(tx.project_members.rows[0]).toMatchObject({ project_id: res.id, user_id: 'manager' });
  });

  it('employee cannot create a project (403, no row)', async () => {
    const { tx, service, actor } = await setup();
    await expect(
      service.create(await actor('employee'), { organization_name: 'X', organization_type: 'vendor' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.projects.rows).toHaveLength(0);
  });

  it('blank organization name is rejected with 400', async () => {
    const { tx, service, actor } = await setup();
    await expect(
      service.create(await actor('manager'), { organization_name: '   ', organization_type: 'vendor' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.projects.rows).toHaveLength(0);
  });

  it('employee lists only the projects they are assigned to', async () => {
    const { service, actor } = await setup();
    const mgr = await actor('manager');
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      ids.push((await service.create(mgr, { organization_name: `Org ${i}`, organization_type: 'other' })).id);
    }
    await service.addMember(mgr, ids[1], 'employee');
    await service.addMember(mgr, ids[3], 'employee');
    const res = await service.list(await actor('employee'), 1, 25);
    expect(res.total).toBe(2);
    expect(res.items.map((p) => p.id).sort()).toEqual([ids[1], ids[3]].sort());
    expect(res.items[0].organization.name).toMatch(/^Org /);
  });

  it('external user is isolated from another company', async () => {
    const { tx, service, actor, orgs } = await setup();
    const pA = await tx.projects.create({ data: { organization_id: orgs.orgA.id, name: 'A', status: 'active' } });
    const pB = await tx.projects.create({ data: { organization_id: orgs.orgB.id, name: 'B', status: 'active' } });
    await tx.project_members.create({ data: { project_id: pA.id, user_id: 'extA' } });
    // Even a (mistaken) membership must not leak another company's data.
    await tx.project_members.create({ data: { project_id: pB.id, user_id: 'extA' } });
    const extA = await actor('extA');
    expect(extA.isExternal).toBe(true);
    await expect(service.get(extA, pB.id)).rejects.toBeInstanceOf(ForbiddenException);
    const list = await service.list(extA, 1, 25);
    expect(list.items.map((p) => p.id)).toEqual([pA.id]);
    expect((await service.get(extA, pA.id)).organization.name).toBe('Company A');
  });

  it('non-member employee gets 403, missing project 404', async () => {
    const { service, actor } = await setup();
    const p = await service.create(await actor('manager'), { organization_name: 'Z', organization_type: 'client' });
    await expect(service.get(await actor('employee'), p.id)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.get(await actor('admin'), 'nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('admin archives: hidden from default list, writes 403, data retained', async () => {
    const { tx, service, actor } = await setup();
    const admin = await actor('admin');
    const p = await service.create(admin, { organization_name: 'Old', organization_type: 'vendor' });
    await expect(service.archive(await actor('manager'), p.id)).rejects.toBeInstanceOf(ForbiddenException);
    expect(await service.archive(admin, p.id)).toEqual({ id: p.id, status: 'archived' });
    expect((await service.list(admin, 1, 25)).total).toBe(0);
    expect((await service.list(admin, 1, 25, true)).total).toBe(1);
    await expect(service.update(admin, p.id, { name: 'New' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.projects.rows).toHaveLength(1);
    expect(tx.channels.rows).toHaveLength(1);
  });

  it('manager updates the project name', async () => {
    const { service, actor } = await setup();
    const mgr = await actor('manager');
    const p = await service.create(mgr, { organization_name: 'Initech', organization_type: 'vendor' });
    expect(await service.update(mgr, p.id, { name: 'Initech HQ' })).toEqual({ id: p.id, name: 'Initech HQ', status: 'active' });
  });

  it('get returns members with display names', async () => {
    const { service, actor } = await setup();
    const mgr = await actor('manager');
    const p = await service.create(mgr, { organization_name: 'Hooli', organization_type: 'client' });
    const added = await service.addMember(mgr, p.id, 'employee');
    expect(added).toMatchObject({ project_id: p.id, user_id: 'employee' });
    const detail = await service.get(mgr, p.id);
    expect(detail.members.map((m) => m.id).sort()).toEqual(['employee', 'manager']);
  });
});
