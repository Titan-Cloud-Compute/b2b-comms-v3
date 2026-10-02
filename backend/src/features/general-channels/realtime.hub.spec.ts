import type { Actor } from '../projects/projects.policy';
import { RealtimeEvent, RealtimeHub } from './realtime.hub';

const actor = (userId: string, isExternal = false): Actor => ({
  userId,
  role: 'USER',
  organizationId: isExternal ? 'org-x' : 'org-int',
  isExternal,
});

const event: RealtimeEvent = { type: 'message.created', channelId: 'c1', projectId: 'p1', payload: { id: 'm1' } };

describe('RealtimeHub', () => {
  it('delivers events to every subscribed client', () => {
    const hub = new RealtimeHub();
    const a: RealtimeEvent[] = [];
    const b: RealtimeEvent[] = [];
    hub.subscribe({ actor: actor('a'), send: (e) => a.push(e) });
    hub.subscribe({ actor: actor('b'), send: (e) => b.push(e) });
    expect(hub.publish(event)).toBe(2);
    expect(a).toEqual([event]);
    expect(b).toEqual([event]);
  });

  it('applies the audience filter', () => {
    const hub = new RealtimeHub();
    const internal: RealtimeEvent[] = [];
    const external: RealtimeEvent[] = [];
    hub.subscribe({ actor: actor('i'), send: (e) => internal.push(e) });
    hub.subscribe({ actor: actor('x', true), send: (e) => external.push(e) });
    expect(hub.publish(event, (who) => !who.isExternal)).toBe(1);
    expect(internal).toHaveLength(1);
    expect(external).toHaveLength(0);
  });

  it('stops delivering after unsubscribe', () => {
    const hub = new RealtimeHub();
    const got: RealtimeEvent[] = [];
    const off = hub.subscribe({ actor: actor('a'), send: (e) => got.push(e) });
    off();
    expect(hub.size).toBe(0);
    expect(hub.publish(event)).toBe(0);
    expect(got).toHaveLength(0);
  });

  it('drops a failing client without blocking the others', () => {
    const hub = new RealtimeHub();
    const got: RealtimeEvent[] = [];
    hub.subscribe({ actor: actor('bad'), send: () => { throw new Error('closed'); } });
    hub.subscribe({ actor: actor('ok'), send: (e) => got.push(e) });
    expect(hub.publish(event)).toBe(1);
    expect(got).toHaveLength(1);
    expect(hub.size).toBe(1);
  });
});
