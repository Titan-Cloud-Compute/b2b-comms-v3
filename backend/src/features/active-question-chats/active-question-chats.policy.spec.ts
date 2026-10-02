import { isBlankText, isClosedQuestion, resolvedSides, sideOf, statusFor } from './active-question-chats.policy';

describe('Active Question Chats policy', () => {
  it('maps external-org actors to the external side', () => {
    expect(sideOf({ isExternal: true })).toBe('external');
    expect(sideOf({ isExternal: false })).toBe('internal');
  });

  it('dedupes and orders resolved sides, ignoring junk', () => {
    expect(resolvedSides([{ side: 'internal' }, { side: 'internal' }, { side: 'bogus' }, { side: null }])).toEqual(['internal']);
    expect(resolvedSides([{ side: 'internal' }, { side: 'external' }])).toEqual(['external', 'internal']);
  });

  it('is resolved only when both parties marked it', () => {
    expect(statusFor([])).toBe('open');
    expect(statusFor(['internal'])).toBe('open');
    expect(statusFor(['external'])).toBe('open');
    expect(statusFor(['external', 'internal'])).toBe('resolved');
  });

  it('treats empty / whitespace / tag-only text as blank', () => {
    expect(isBlankText('')).toBe(true);
    expect(isBlankText('   ')).toBe(true);
    expect(isBlankText('<p>&nbsp;</p>')).toBe(true);
    expect(isBlankText(undefined)).toBe(true);
    expect(isBlankText('Which drawing revision?')).toBe(false);
  });

  it('only resolved question channels are closed', () => {
    expect(isClosedQuestion({ kind: 'question', status: 'resolved' })).toBe(true);
    expect(isClosedQuestion({ kind: 'question', status: 'open' })).toBe(false);
    expect(isClosedQuestion({ kind: 'general', status: 'resolved' })).toBe(false);
    expect(isClosedQuestion(null)).toBe(false);
  });
});
