import { Injectable } from '@nestjs/common';
import type { Actor } from '../projects/projects.policy';

/** An event pushed to connected clients over GET /api/realtime/socket. */
export interface RealtimeEvent {
  type: 'message.created' | 'message.updated' | 'message.deleted' | 'channel.created';
  channelId: string;
  projectId: string;
  payload: unknown;
}

export interface RealtimeClient {
  actor: Actor;
  send(event: RealtimeEvent): void;
}

/**
 * In-process pub/sub hub. Each open realtime connection registers a client;
 * publish() fans an event out synchronously to every client the audience
 * filter admits (channel visibility is decided by the caller).
 */
@Injectable()
export class RealtimeHub {
  private readonly clients = new Set<RealtimeClient>();

  subscribe(client: RealtimeClient): () => void {
    this.clients.add(client);
    return () => {
      this.clients.delete(client);
    };
  }

  get size(): number {
    return this.clients.size;
  }

  /** Returns the number of clients the event was delivered to. */
  publish(event: RealtimeEvent, audience: (actor: Actor) => boolean = () => true): number {
    let delivered = 0;
    for (const client of [...this.clients]) {
      let admitted = false;
      try {
        admitted = audience(client.actor);
      } catch {
        admitted = false;
      }
      if (!admitted) continue;
      try {
        client.send(event);
        delivered++;
      } catch {
        // A broken connection must never block delivery to the others.
        this.clients.delete(client);
      }
    }
    return delivered;
  }
}
