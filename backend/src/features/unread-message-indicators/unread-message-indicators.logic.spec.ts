/**
 * Story: Unread Message Indicators — pure logic.
 */
import {
  canSeeChannel,
  incrementUnread,
  isPrivileged,
  matchUnreadRequest,
  resetReadState,
  shapeUnreadCounts,
  unreadRecipients,
} from './unread-message-indicators.logic';

describe('unreadRecipients', () => {
  const people = [
    { userId: 'author', isExternal: false },
    { userId: 'emp', isExternal: false },
    { userId: 'ext', isExternal: true },
    { userId: 'emp', isExternal: false },
  ];

  it('excludes the author and de-duplicates', () => {
    expect(unreadRecipients(people, 'author', { id: 'c1', internal_only: false }).sort()).toEqual(['emp', 'ext']);
  });

  it('skips external users for internal-only channels', () => {
    expect(unreadRecipients(people, 'author', { id: 'c1', internal_only: true })).toEqual(['emp']);
  });
});

describe('incrementUnread', () => {
  it('goes from N to N+1', () => {
    expect(incrementUnread(3)).toBe(4);
    expect(incrementUnread(0)).toBe(1);
  });
  it('treats missing or invalid as 0', () => {
    expect(incrementUnread(null)).toBe(1);
    expect(incrementUnread(undefined)).toBe(1);
    expect(incrementUnread(-5)).toBe(1);
  });
});

describe('resetReadState', () => {
  it('zeroes unread_count and records the last message', () => {
    expect(resetReadState('c1', 'u1', 'm9')).toEqual({ channel_id: 'c1', user_id: 'u1', last_read_message_id: 'm9', unread_count: 0 });
  });
});

describe('shapeUnreadCounts', () => {
  const channels = [
    { id: 'c-general', internal_only: false },
    { id: 'c-internal', internal_only: true },
    { id: 'c-design', internal_only: false },
  ];
  const states = [{ channel_id: 'c-general', user_id: 'u1', unread_count: 3 }, { channel_id: 'c-internal', user_id: 'u1', unread_count: 2 }];

  it('returns stored counts and 0 for channels without a row', () => {
    expect(shapeUnreadCounts({ isExternal: false }, channels, states)).toEqual({
      counts: [
        { channel_id: 'c-general', unread_count: 3 },
        { channel_id: 'c-internal', unread_count: 2 },
        { channel_id: 'c-design', unread_count: 0 },
      ],
    });
  });

  it('omits internal-only channels for external users', () => {
    const ids = shapeUnreadCounts({ isExternal: true }, channels, states).counts.map((c) => c.channel_id);
    expect(ids).toEqual(['c-general', 'c-design']);
  });
});

describe('access helpers', () => {
  it('canSeeChannel', () => {
    expect(canSeeChannel({ isExternal: true }, { internal_only: true })).toBe(false);
    expect(canSeeChannel({ isExternal: false }, { internal_only: true })).toBe(true);
  });
  it('isPrivileged', () => {
    expect(isPrivileged('manager')).toBe(true);
    expect(isPrivileged('ADMIN')).toBe(true);
    expect(isPrivileged('USER')).toBe(false);
  });
});

describe('matchUnreadRequest', () => {
  it('matches posting a message', () => {
    expect(matchUnreadRequest('POST', '/api/channels/c1/messages')).toEqual({ kind: 'post', channelId: 'c1' });
  });
  it('matches viewing the first page only', () => {
    expect(matchUnreadRequest('GET', '/api/channels/c1/messages')).toEqual({ kind: 'view', channelId: 'c1' });
    expect(matchUnreadRequest('GET', '/api/channels/c1/messages?limit=20')).toEqual({ kind: 'view', channelId: 'c1' });
    expect(matchUnreadRequest('GET', '/api/channels/c1/messages?cursor=2024-01-01')).toBeNull();
  });
  it('ignores other requests', () => {
    expect(matchUnreadRequest('PATCH', '/api/channels/c1/messages')).toBeNull();
    expect(matchUnreadRequest('POST', '/api/channels/c1/read')).toBeNull();
    expect(matchUnreadRequest('GET', '/api/projects/p1/unread')).toBeNull();
  });
});
