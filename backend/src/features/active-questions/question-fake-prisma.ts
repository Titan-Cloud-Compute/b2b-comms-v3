/* eslint-disable @typescript-eslint/no-explicit-any */
/** In-memory Prisma stand-in shared by the Active Questions specs. */

type Row = Record<string, any>;

export const TEST_SESSIONS: Record<string, any> = {
  admin: { userId: 'admin', role: 'ADMIN', firmId: null, organizationId: 'org-int' },
  emp: { userId: 'emp', role: 'USER', firmId: null, organizationId: 'org-int' },
  extA: { userId: 'extA', role: 'USER', firmId: null, organizationId: 'org-a' },
  extB: { userId: 'extB', role: 'USER', firmId: null, organizationId: 'org-b' },
  outsider: { userId: 'outsider', role: 'USER', firmId: null, organizationId: 'org-int' },
};

export function makeQuestionFakePrisma() {
  const users: Row[] = [
    { id: 'admin', email: 'admin@x', name: 'Admin', organization_id: 'org-int' },
    { id: 'emp', email: 'emp@x', name: 'Emp', organization_id: 'org-int' },
    { id: 'extA', email: 'ext@x', name: 'Ext', organization_id: 'org-a' },
    { id: 'extB', email: 'extb@x', name: 'ExtB', organization_id: 'org-b' },
    { id: 'outsider', email: 'out@x', name: 'Out', organization_id: 'org-int' },
  ];
  const organizations: Row[] = [
    { id: 'org-int', name: 'Us', type: 'other', is_internal: true },
    { id: 'org-a', name: 'Company A', type: 'vendor', is_internal: false },
    { id: 'org-b', name: 'Company B', type: 'vendor', is_internal: false },
  ];
  const projects: Row[] = [{ id: 'p0', organization_id: 'org-a', name: 'P0', status: 'active', created_by: 'admin' }];
  const members: Row[] = [
    { project_id: 'p0', user_id: 'emp' },
    { project_id: 'p0', user_id: 'extA' },
  ];
  const files: Row[] = [{ id: 'f1', project_id: 'p0', deleted_at: null }];
  const channels: Row[] = [];
  const messages: Row[] = [];
  const attachments: Row[] = [];
  const resolutions: Row[] = [];
  let seq = 0;
  const nextId = (p: string) => `${p}-${++seq}`;
  const time = () => new Date(Date.UTC(2026, 0, 1, 0, 0, ++seq));

  const projectWith = (p: Row, include: any = {}) => ({
    ...p,
    ...(include?.members ? { members: members.filter((m) => m.project_id === p.id) } : {}),
  });
  const messageWith = (m: Row, include: any = {}) => ({
    ...m,
    ...(include?.attachments ? { attachments: attachments.filter((a) => a.message_id === m.id) } : {}),
    ...(include?.author ? { author: users.find((u) => u.id === m.author_id) } : {}),
  });

  const db: any = {
    user: { findUnique: async ({ where }: any) => users.find((u) => u.id === where.id) ?? null },
    organizations: { findUnique: async ({ where }: any) => organizations.find((o) => o.id === where.id) ?? null },
    projects: {
      findUnique: async ({ where, include }: any) => {
        const p = projects.find((x) => x.id === where.id);
        return p ? projectWith(p, include) : null;
      },
    },
    files: {
      findMany: async ({ where }: any) =>
        files.filter((f) => where.id.in.includes(f.id) && f.project_id === where.project_id && !f.deleted_at),
    },
    channels: {
      findMany: async ({ where, include }: any) =>
        channels
          .filter(
            (c) =>
              c.project_id === where.project_id &&
              (where.kind === undefined || c.kind === where.kind) &&
              (where.internal_only === undefined || c.internal_only === where.internal_only),
          )
          .map((c) => ({
            ...c,
            ...(include?.resolutions ? { resolutions: resolutions.filter((r) => r.channel_id === c.id) } : {}),
          })),
      findUnique: async ({ where, include }: any) => {
        const c = channels.find((x) => x.id === where.id);
        if (!c) return null;
        const p = projects.find((x) => x.id === c.project_id)!;
        return include?.project ? { ...c, project: projectWith(p, include.project.include) } : { ...c };
      },
      create: async ({ data }: any) => {
        const row = { id: nextId('ch'), created_at: time(), ...data };
        channels.push(row);
        return { ...row };
      },
      update: async ({ where, data }: any) => {
        const c = channels.find((x) => x.id === where.id)!;
        Object.assign(c, data);
        return { ...c };
      },
    },
    messages: {
      findMany: async ({ where, include }: any) =>
        messages.filter((m) => m.channel_id === where.channel_id).map((m) => messageWith(m, include)),
      findUnique: async ({ where, include }: any) => {
        const m = messages.find((x) => x.id === where.id);
        return m ? messageWith(m, include) : null;
      },
      create: async ({ data, include }: any) => {
        const { attachments: nested, ...rest } = data;
        const row = { id: nextId('msg'), created_at: time(), edited_at: null, deleted_at: null, ...rest };
        messages.push(row);
        for (const a of nested?.create ?? []) attachments.push({ id: nextId('att'), message_id: row.id, ...a });
        return messageWith(row, include);
      },
    },
    message_attachments: {
      count: async ({ where }: any) => attachments.filter((a) => a.message_id === where.message_id).length,
    },
    question_resolutions: {
      findMany: async ({ where }: any) => resolutions.filter((r) => r.channel_id === where.channel_id),
      upsert: async ({ where, create, update }: any) => {
        const key = where.channel_id_side;
        const existing = resolutions.find((r) => r.channel_id === key.channel_id && r.side === key.side);
        if (existing) return Object.assign(existing, update);
        const row = { resolved_at: time(), ...create };
        resolutions.push(row);
        return row;
      },
      deleteMany: async ({ where }: any) => {
        let count = 0;
        for (let i = resolutions.length - 1; i >= 0; i--) {
          if (resolutions[i].channel_id === where.channel_id) {
            resolutions.splice(i, 1);
            count++;
          }
        }
        return { count };
      },
    },
  };
  return { db, channels, messages, attachments, resolutions };
}
