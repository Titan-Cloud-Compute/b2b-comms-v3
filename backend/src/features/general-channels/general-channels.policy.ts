import { z } from 'zod';
import { Actor, ProjectFacts, canViewProject, canWriteProject } from '../projects/projects.policy';

export const CHANNEL_KIND_GENERAL = 'general';

export interface ChannelFacts {
  internal_only: boolean;
}

export const createChannelSchema = z.object({
  name: z
    .string({ required_error: 'name is required' })
    .trim()
    .min(1, 'name must not be blank')
    .max(100, 'name is too long'),
  internalOnly: z.boolean().optional().default(false),
});
export type CreateChannelInput = z.infer<typeof createChannelSchema>;

export const postMessageSchema = z.object({
  bodyHtml: z.string().max(50_000, 'message is too long').optional().default(''),
  attachmentFileIds: z.array(z.string().trim().min(1)).max(20).optional().default([]),
  referenceId: z.string().trim().min(1).optional(),
});
export type PostMessageInput = z.infer<typeof postMessageSchema>;

export const editMessageSchema = z.object({
  bodyHtml: z.string({ required_error: 'bodyHtml is required' }).max(50_000, 'message is too long'),
});
export type EditMessageInput = z.infer<typeof editMessageSchema>;

/** Only internal Managers and Admins create channels. */
export function canCreateChannel(actor: Actor, project: ProjectFacts): boolean {
  if (actor.isExternal) return false;
  if (actor.role !== 'ADMIN' && actor.role !== 'MANAGER') return false;
  return canWriteProject(actor, project);
}

/** Project visibility plus: internal-only channels are invisible to external users. */
export function canViewChannel(actor: Actor, project: ProjectFacts, channel: ChannelFacts): boolean {
  if (!canViewProject(actor, project)) return false;
  if (channel.internal_only && actor.isExternal) return false;
  return true;
}

/** Only the author may edit or delete a message. */
export function canModifyMessage(actor: Actor, message: { author_id: string }): boolean {
  return message.author_id === actor.userId;
}
