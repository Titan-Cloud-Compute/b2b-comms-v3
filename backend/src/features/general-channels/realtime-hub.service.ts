import { Injectable } from '@nestjs/common';

export interface RealtimeEvent {
  type: string;
  channel_id: string;
  payload: unknown;
}

type Listener = (event: RealtimeEvent) => void;

/**
 * In-process fan-out for channel events (message.created / updated / deleted).
 * Subscribers are per-channel; access is checked before subscribing.
 */
@Injectable()
export class RealtimeHubService {
  private readonly listeners = new Map<string, Set<Listener>>();

  subscribe(channelId: string, listener: Listener): () => void {
    let set = this.listeners.get(channelId);
    if (!set) {
      set = new Set();
      this.listeners.set(channelId, set);
    }
    set.add(listener);
    return () => {
      const s = this.listeners.get(channelId);
      if (!s) return;
      s.delete(listener);
      if (s.size === 0) this.listeners.delete(channelId);
    };
  }

  publish(event: RealtimeEvent): void {
    const set = this.listeners.get(event.channel_id);
    if (!set) return;
    for (const l of [...set]) {
      try {
        l(event);
      } catch {
        /* a broken subscriber must not affect the others */
      }
    }
  }

  subscriberCount(channelId: string): number {
    return this.listeners.get(channelId)?.size ?? 0;
  }
}
