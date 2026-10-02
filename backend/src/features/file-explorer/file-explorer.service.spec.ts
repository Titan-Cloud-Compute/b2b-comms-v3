/* eslint-disable @typescript-eslint/no-explicit-any */
import { BadRequestException, ForbiddenException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { FileExplorerService, FeActor, UploadedBlob } from './file-explorer.service';

type Row = Record<string, any>;

class Table {
  rows: Row[] = [];
  private seq = 0;
  constructor(private readonly prefix: string) {}
  private match(r: Row, where: Row = {}) {
    return Object.entries(where).every(([k, v]) => (r[k] ?? null) === v);
  }
  async findMany(args: { where?: Row } = {}) {
    return this.rows.filter((r) => this.match(r, args.where));
  }
  async findUnique(args: { where: Row }) {
    return this.rows.find((r) => this.match(r, args.where)) ?? null;
  }
  async findFirst(args: { where?: Row } = {}) {
    return this.rows.find((r) => this.match(r, args.where)) ?? null;
  }
  async create(args: { data: Row }) {
    const row = { id: `${this.prefix}${++this.seq}`, ...args.data };
    this.rows.push(row);
    return row;
  }
  async update(args: { where: Row; data: Row }) {
    const row = this.rows.find((r) => this.match(r, args.where));
    if (!row) throw new Error('record not found');
    Object.assign(row, args.data);
    return row;
  }
}

function setup() {
  const tx = {
    user: new Table('u'),
    organizations: new Table('org'),
    projects: new Table('p'),
    project_members: new Table('pm'),
    folders: new Table('fo'),
    files: new Table('fi'),
    file_versions: new Table('fv'),
  };
  const prisma = { runAsAdmin: (fn: (t: unknown) => unknown) => fn(tx) };
  const storage = {
    putObject: jest.fn(async (key: string) => ({ etag: 'e', bucket: 'b', key })),
    getSignedUrl: jest.fn(async (key: string, ttl: number) => `https://s3/${key}?X-Amz-Expires=${ttl}`),
    deleteObject: jest.fn(async () => undefined),
  };
  const svc = new FileExplorerService(prisma as any, storage as any);
  return { tx, svc, storage };
}

const member: FeActor = { userId: 'emp', role: 'USER', organizationId: null, isExternal: false };
const outsider: FeActor = { userId: 'other', role: 'USER', organizationId: null, isExternal: false };
const blob = (name: string, size = 10, mimetype = 'text/plain'): UploadedBlob => ({
  originalname: name,
  mimetype,
  size,
  buffer: Buffer.alloc(Math.min(size, 16)),
});

async function seed(tx: ReturnType<typeof setup>['tx']) {
  await tx.projects.rows.push({ id: 'p1', name: 'Globex', organization_id: null });
  await tx.project_members.create({ data: { project_id: 'p1', user_id: 'emp' } });
}

describe('FileExplorerService', () => {
  it('rejects anonymous callers with 401', async () => {
    const { svc } = setup();
    await expect(svc.resolveActor(undefined)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('uploads files, lists them in the folder and versions same-name uploads', async () => {
    const { tx, svc } = setup();
    await seed(tx);
    const folder = await svc.createFolder(member, 'p1', { name: 'Docs' });
    await svc.upload(member, 'p1', folder.id, [blob('a.txt', 10), blob('b.pdf', 20, 'application/pdf')]);
    expect(tx.files.rows).toHaveLength(2);
    expect(tx.file_versions.rows).toHaveLength(2);

    const res = await svc.upload(member, 'p1', folder.id, [blob('a.txt', 30)]);
    expect(res.items[0].version_number).toBe(2);
    expect(tx.files.rows).toHaveLength(2);
    const file = tx.files.rows.find((f) => f.name === 'a.txt')!;
    const current = tx.file_versions.rows.find((v) => v.id === file.current_version_id)!;
    expect(current.version_number).toBe(2);

    const versions = await svc.versions(member, file.id);
    expect(versions.items.map((v) => v.version_number)).toEqual([2, 1]);

    const listing = await svc.list(member, 'p1', folder.id);
    expect(listing.folder.breadcrumbs.map((b) => b.name)).toEqual(['Globex', 'Docs']);
    expect(listing.files.map((f) => f.name)).toEqual(['a.txt', 'b.pdf']);
    expect(listing.files[0].size_bytes).toBe(30);

    const search = await svc.list(member, 'p1', null, 'b.p');
    expect(search.files.map((f) => f.name)).toEqual(['b.pdf']);
  });

  it('returns a presigned download URL valid for 300 seconds', async () => {
    const { tx, svc, storage } = setup();
    await seed(tx);
    const up = await svc.upload(member, 'p1', null, [blob('x.txt')]);
    const dl = await svc.download(member, up.items[0].id);
    expect(dl.expires_in).toBe(300);
    expect(storage.getSignedUrl).toHaveBeenCalledWith(expect.any(String), 300);
  });

  it('forbids non-members with 403', async () => {
    const { tx, svc } = setup();
    await seed(tx);
    await expect(svc.list(outsider, 'p1')).rejects.toBeInstanceOf(ForbiddenException);
    const up = await svc.upload(member, 'p1', null, [blob('x.txt')]);
    await expect(svc.download(outsider, up.items[0].id)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.deleteFile(outsider, up.items[0].id)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects empty, oversized and blocked uploads with 400 and stores nothing', async () => {
    const { tx, svc } = setup();
    await seed(tx);
    await expect(svc.upload(member, 'p1', null, [blob('e.txt', 0)])).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.upload(member, 'p1', null, [blob('big.bin', 100 * 1024 * 1024 + 1)])).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.upload(member, 'p1', null, [blob('evil.exe')])).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.files.rows).toHaveLength(0);
    expect(tx.file_versions.rows).toHaveLength(0);
  });

  it('returns 503 retryable and leaves no rows when storage is down', async () => {
    const { tx, svc, storage } = setup();
    await seed(tx);
    storage.putObject.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const err = await svc.upload(member, 'p1', null, [blob('a.txt')]).catch((e) => e);
    expect(err).toBeInstanceOf(ServiceUnavailableException);
    expect((err as ServiceUnavailableException).getResponse()).toMatchObject({ retryable: true });
    expect(tx.files.rows).toHaveLength(0);
  });

  it('renames, moves and deletes folders and files', async () => {
    const { tx, svc } = setup();
    await seed(tx);
    const a = await svc.createFolder(member, 'p1', { name: 'A' });
    const b = await svc.createFolder(member, 'p1', { name: 'B' });
    expect((await svc.updateFolder(member, b.id, { name: 'B2', parent_id: a.id })).parent_id).toBe(a.id);
    await expect(svc.updateFolder(member, a.id, { parent_id: b.id })).rejects.toBeInstanceOf(BadRequestException);
    const up = await svc.upload(member, 'p1', null, [blob('f.txt')]);
    const moved = await svc.updateFile(member, up.items[0].id, { name: 'g.txt', folder_id: a.id });
    expect(moved).toEqual({ id: up.items[0].id, name: 'g.txt', folder_id: a.id });
    await svc.deleteFile(member, up.items[0].id);
    await svc.deleteFolder(member, b.id);
    const listing = await svc.list(member, 'p1', a.id);
    expect(listing.files).toHaveLength(0);
    expect(listing.folders).toHaveLength(0);
  });
});
