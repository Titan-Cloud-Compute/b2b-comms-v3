import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  DOWNLOAD_URL_EXPIRY_SECONDS,
  FileExplorerService,
  MAX_UPLOAD_BYTES,
  StorageUnavailableException,
} from './file-explorer.service';

const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const F1 = '33333333-3333-4333-8333-333333333333';
const FO1 = '44444444-4444-4444-8444-444444444444';
const FO9 = '55555555-5555-4555-8555-555555555555';

function makePrisma(opts: { member?: boolean } = {}) {
  const member = opts.member ?? true;
  const prisma: any = {
    project_members: { findUnique: jest.fn().mockResolvedValue(member ? { project_id: P1, user_id: 'u1' } : null) },
    folders: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: FO1, ...data })),
      update: jest.fn().mockImplementation(({ where, data }) =>
        Promise.resolve({ id: where.id, project_id: P1, parent_id: null, name: 'x', ...data })),
    },
    files: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: F1, versions: [], ...data })),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    file_versions: {
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: `v${data.version_number}`, ...data })),
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
  prisma.files.update.mockImplementation(({ where, data }: any) =>
    Promise.resolve({
      id: where.id,
      project_id: P1,
      folder_id: null,
      name: 'spec.pdf',
      mime_type: 'application/pdf',
      ...data,
      current_version: null,
    }));
  prisma.$transaction = jest.fn().mockImplementation((arg: any) =>
    typeof arg === 'function' ? arg(prisma) : Promise.all(arg));
  return prisma;
}

function makeMinio(ok = true) {
  return {
    putObject: jest.fn().mockImplementation(() => (ok ? Promise.resolve({}) : Promise.reject(new Error('down')))),
    getSignedUrl: jest.fn().mockImplementation(() => (ok ? Promise.resolve('https://minio/signed') : Promise.reject(new Error('down')))),
    deleteObject: jest.fn().mockResolvedValue(undefined),
  };
}

const pdf = (size = 10) => ({ originalname: 'spec.pdf', mimetype: 'application/pdf', size, buffer: Buffer.alloc(size) });

describe('FileExplorerService', () => {
  it('rejects non-members with 403', async () => {
    const svc = new FileExplorerService(makePrisma({ member: false }), makeMinio() as any);
    await expect(svc.list(P1, 'u1')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.upload(P1, 'u1', null, [pdf()])).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('uploads a new file as version 1', async () => {
    const prisma = makePrisma();
    const svc = new FileExplorerService(prisma, makeMinio() as any);
    await svc.upload(P1, 'u1', null, [pdf()]);
    expect(prisma.files.create).toHaveBeenCalled();
    expect(prisma.file_versions.create.mock.calls[0][0].data.version_number).toBe(1);
    expect(prisma.files.update.mock.calls[0][0].data.current_version_id).toBe('v1');
  });

  it('increments the version when a file with the same name exists', async () => {
    const prisma = makePrisma();
    prisma.files.findFirst.mockResolvedValue({ id: F1, versions: [{ version_number: 2 }] });
    const svc = new FileExplorerService(prisma, makeMinio() as any);
    await svc.upload(P1, 'u1', null, [pdf()]);
    expect(prisma.files.create).not.toHaveBeenCalled();
    expect(prisma.file_versions.create.mock.calls[0][0].data.version_number).toBe(3);
    expect(prisma.files.update.mock.calls[0][0].data.current_version_id).toBe('v3');
  });

  it('rejects empty, oversized and blocked uploads with 400 and stores nothing', async () => {
    const prisma = makePrisma();
    const svc = new FileExplorerService(prisma, makeMinio() as any);
    await expect(svc.upload(P1, 'u1', null, [pdf(0)])).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.upload(P1, 'u1', null, [pdf(MAX_UPLOAD_BYTES + 1)])).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      svc.upload(P1, 'u1', null, [{ originalname: 'evil.exe', mimetype: 'application/octet-stream', size: 5, buffer: Buffer.alloc(5) }]),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.files.create).not.toHaveBeenCalled();
    expect(prisma.file_versions.create).not.toHaveBeenCalled();
  });

  it('returns 503 retryable when storage is down and leaves no rows', async () => {
    const prisma = makePrisma();
    const svc = new FileExplorerService(prisma, makeMinio(false) as any);
    const err = await svc.upload(P1, 'u1', null, [pdf()]).catch((e) => e);
    expect(err).toBeInstanceOf(StorageUnavailableException);
    expect(err.getStatus()).toBe(503);
    expect((err.getResponse() as any).retryable).toBe(true);
    expect(prisma.files.create).not.toHaveBeenCalled();
  });

  it('download returns a presigned URL expiring after 300 seconds', async () => {
    const prisma = makePrisma();
    prisma.files.findFirst.mockResolvedValue({ id: F1, project_id: P1, name: 'spec.pdf', current_version_id: 'v1' });
    prisma.file_versions.findUnique.mockResolvedValue({ id: 'v1', storage_key: 'k' });
    const minio = makeMinio();
    const svc = new FileExplorerService(prisma, minio as any);
    const res = await svc.download(F1, 'u1');
    expect(res.url).toBe('https://minio/signed');
    expect(DOWNLOAD_URL_EXPIRY_SECONDS).toBe(300);
    expect(minio.getSignedUrl).toHaveBeenCalledWith('k', 300);
  });

  it('rejects an empty folder name with 400', async () => {
    const prisma = makePrisma();
    const svc = new FileExplorerService(prisma, makeMinio() as any);
    await expect(svc.createFolder(P1, 'u1', { name: '   ' })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.folders.create).not.toHaveBeenCalled();
    const created = await svc.createFolder(P1, 'u1', { name: 'Docs' });
    expect(created.name).toBe('Docs');
  });

  it('rejects moving a file into a folder of another project with 403', async () => {
    const prisma = makePrisma();
    prisma.files.findFirst.mockResolvedValue({ id: F1, project_id: P1, name: 'a', current_version_id: null });
    prisma.folders.findFirst.mockResolvedValue({ id: FO9, project_id: P2 });
    const svc = new FileExplorerService(prisma, makeMinio() as any);
    await expect(svc.updateFile(F1, 'u1', { folderId: FO9 })).rejects.toBeInstanceOf(ForbiddenException);
  });
});
