import { Injectable } from '@nestjs/common';

export interface UnreadChangedEvent {
  type: 'unread.changed';
  channel_id: string;
  payload: { project_id: string | null; unread_count: number };
}

type Listener = (event: UnreadChangedEvent) => void;

/** Per-user fan-out of unread.changed events. */
@Injectable()
export class UnreadHubService {
  private readonly listeners = new Map<string, Set<Listener>>();

  subscribe(userId: string, listener: Listener): () => void {
    let set = this.listeners.get(userId);
    if (!set) {
      set = new Set();
      this.listeners.set(userId, set);
    }
    set.add(listener);
    return () => {
      const s = this.listeners.get(userId);
      if (!s) return;
      s.delete(listener);
      if (s.size === 0) this.listeners.delete(userId);
    };
  }

  publish(userId: string, event: UnreadChangedEvent): void {
    const set = this.listeners.get(userId);
    if (!set) return;
    for (const l of [...set]) {
      try {
        l(event);
      } catch {
        /* a broken subscriber must not affect the others */
      }
    }
  }
}
