/**
 * Story: Active Question Chats — pure policy (no Nest, no Prisma).
 */
import type { GcActor } from '../general-channels/general-channels.logic';

export type QuestionSide = 'internal' | 'external';
export const QUESTION_KIND = 'question';
export const QUESTION_OPEN = 'open';
export const QUESTION_RESOLVED = 'resolved';

/** Which party the actor speaks for. */
export function sideOf(actor: Pick<GcActor, 'isExternal'>): QuestionSide {
  return actor.isExternal ? 'external' : 'internal';
}

/** Distinct, sorted list of sides that currently hold a resolved mark. */
export function resolvedSides(rows: { side?: string | null }[]): QuestionSide[] {
  const set = new Set<QuestionSide>();
  for (const r of rows) {
    if (r.side === 'internal' || r.side === 'external') set.add(r.side);
  }
  return (['external', 'internal'] as QuestionSide[]).filter((s) => set.has(s));
}

/** A question is resolved only once both parties have marked it. */
export function statusFor(sides: QuestionSide[]): 'open' | 'resolved' {
  return sides.includes('internal') && sides.includes('external') ? QUESTION_RESOLVED : QUESTION_OPEN;
}

/** Blank check for title / first message (HTML tags and nbsp ignored). */
export function isBlankText(value: unknown): boolean {
  if (typeof value !== 'string') return true;
  return value.replace(/<[^>]*>/g, '').replace(/&nbsp;| /g, ' ').trim() === '';
}

/** True when a channel row is a question that no longer accepts messages. */
export function isClosedQuestion(channel: { kind?: string | null; status?: string | null } | null | undefined): boolean {
  return !!channel && channel.kind === QUESTION_KIND && channel.status === QUESTION_RESOLVED;
}
