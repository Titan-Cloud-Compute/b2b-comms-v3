import { z } from 'zod';
import type { Actor } from '../projects/projects.policy';

export const CHANNEL_KIND_QUESTION = 'question';
export const QUESTION_STATUS_OPEN = 'open';
export const QUESTION_STATUS_RESOLVED = 'resolved';

export type QuestionSide = 'internal' | 'external';
export const QUESTION_SIDES: readonly QuestionSide[] = ['internal', 'external'];

export const createQuestionSchema = z.object({
  title: z
    .string({ required_error: 'title is required' })
    .trim()
    .min(1, 'title must not be blank')
    .max(200, 'title is too long'),
  bodyHtml: z
    .string({ required_error: 'first message is required' })
    .max(50_000, 'message is too long'),
  attachmentFileIds: z.array(z.string().trim().min(1)).max(20).optional().default([]),
});
export type CreateQuestionInput = z.infer<typeof createQuestionSchema>;

/** Which party of the conversation the caller belongs to. */
export function sideOf(actor: Actor): QuestionSide {
  return actor.isExternal ? 'external' : 'internal';
}

/** A question is resolved only once every side has marked it resolved. */
export function bothSidesResolved(sides: readonly string[]): boolean {
  return QUESTION_SIDES.every((s) => sides.includes(s));
}
