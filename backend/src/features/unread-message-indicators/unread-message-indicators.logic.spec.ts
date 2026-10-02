/**
 * Story: Unread Message Indicators — pure logic.
 */
import {
  incrementUnread,
  messagePostTarget,
  resetUnread,
  selectRecipients,
  shapeCounts,
} from './unread-message-indicators.logic';

describe('selectRecipients', () => {
  it('excludes the author and deduplicates', () => {
    expect(selectRecipients(['a', 'b', 'a', null, 'author'], 'author', { internal_only: false }).sort()).toEqual(['a', 'b']);
  });

  it('excludes External users from internal-only channels', () => {
    expect(selectRecipients(['a', 'ext'], 'x', { internal_only: true }, new Set(['ext']))).toEqual(['a']);
  });

  it('keeps External users on shared channels', () => {
    expect(selectRecipients(['a', 'ext'], 'x', { internal_only: false }, new Set(['ext'])).sort()).toEqual(['a', 'ext']);
  });
});

describe('increment / reset', () => {
  it('increments N to N+1', () => {
    expect(incrementUnread(3)).toBe(4);
    expect(incrementUnread(0)).toBe(1);
  });

  it('treats missing or invalid counts as 0', () => {
    expect(incrementUnread(null)).toBe(1);
    expect(incrementUnread(undefined)).toBe(1);
    expect(incrementUnread(-5)).toBe(1);
  });

  it('resets to 0 on read', () => {
    expect(resetUnread()).toBe(0);
  });
});

describe('shapeCounts', () => {
  it('returns one entry per visible channel with the stored count', () => {
    const out = shapeCounts(['c1', 'c2'], [{ channel_id: 'c1', user_id: 'u1', unread_count: 5 }], 'u1');
    expect(out).toEqual({ counts: [{ channel_id: 'c1', unread_count: 5 }, { channel_id: 'c2', unread_count: 0 }] });
  });

  it("ignores other users' rows and channels that are not visible", () => {
    const out = shapeCounts(
      ['c1'],
      [
        { channel_id: 'c1', user_id: 'u2', unread_count: 9 },
        { channel_id: 'hidden', user_id: 'u1', unread_count: 4 },
      ],
      'u1',
    );
    expect(out.counts).toEqual([{ channel_id: 'c1', unread_count: 0 }]);
  });
});

describe('messagePostTarget', () => {
  it('matches POST /api/channels/:id/messages only', () => {
    expect(messagePostTarget({ method: 'POST', originalUrl: '/api/channels/c1/messages?x=1' })).toBe('c1');
    expect(messagePostTarget({ method: 'GET', originalUrl: '/api/channels/c1/messages' })).toBeNull();
    expect(messagePostTarget({ method: 'POST', originalUrl: '/api/channels/c1/read' })).toBeNull();
  });
});
