/**
 * Minimal in-memory stand-in for the Prisma transaction client, used only by
 * this feature's unit specs. Supports equality, `{ in }` and `{ not }` filters.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([k, cond]) => {
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('in' in cond) return (cond.in as unknown[]).includes(row[k]);
      if ('not' in cond) return row[k] !== cond.not;
    }
    return row[k] === cond;
  });
}

class Table {
  rows: Row[] = [];
  private seq = 0;
  constructor(private readonly prefix: string) {}
  async findMany(args: { where?: Row; skip?: number; take?: number } = {}) {
    const all = this.rows.filter((r) => matches(r, args.where));
    const start = args.skip ?? 0;
    return all.slice(start, args.take ? start + args.take : undefined);
  }
  async count(args: { where?: Row } = {}) {
    return this.rows.filter((r) => matches(r, args.where)).length;
  }
  async findUnique(args: { where: Row }) {
    return this.rows.find((r) => matches(r, args.where)) ?? null;
  }
  async findFirst(args: { where?: Row } = {}) {
    return this.rows.find((r) => matches(r, args.where)) ?? null;
  }
  async create(args: { data: Row }) {
    const now = new Date();
    const row = { id: `${this.prefix}${++this.seq}`, createdAt: now, updatedAt: now, ...args.data };
    this.rows.push(row);
    return row;
  }
  async update(args: { where: Row; data: Row }) {
    const row = this.rows.find((r) => matches(r, args.where));
    if (!row) throw new Error('record not found');
    Object.assign(row, args.data);
    return row;
  }
}

export function makeFakePrisma() {
  const tx = {
    user: new Table('u'),
    organizations: new Table('org'),
    projects: new Table('p'),
    project_members: new Table('pm'),
    channels: new Table('ch'),
    invitations: new Table('inv'),
  };
  const prisma = { runAsAdmin: (fn: (t: unknown) => unknown) => fn(tx) };
  return { tx, prisma };
}

/** Seeds: internal org with admin/manager/employee, Company A + B with one external each. */
export async function seed(tx: ReturnType<typeof makeFakePrisma>['tx']) {
  const internal = await tx.organizations.create({ data: { name: 'Acme', type: 'other', is_internal: true } });
  const orgA = await tx.organizations.create({ data: { name: 'Company A', type: 'vendor', is_internal: false } });
  const orgB = await tx.organizations.create({ data: { name: 'Company B', type: 'client', is_internal: false } });
  const mk = (id: string, role: string, organizationId: string) =>
    tx.user.create({ data: { id, email: `${id}@demo.local`, name: id, displayName: id, role, organizationId } });
  await mk('admin', 'ADMIN', internal.id);
  await mk('manager', 'MANAGER', internal.id);
  await mk('employee', 'USER', internal.id);
  await mk('extA', 'USER', orgA.id);
  await mk('extB', 'USER', orgB.id);
  return { internal, orgA, orgB };
}
