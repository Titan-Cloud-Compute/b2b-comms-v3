import { Injectable, inject } from '@angular/core';
import { ApiClient } from '../../shared/api/api-client.service';
import { ApiClient as BaseApiClient, MockApiClient } from '../../shared/api/api-client';
import { ensureUnreadMock } from './unread-message-indicators-mocks';

// Contract types for the Unread Message Indicators story.
export interface UnreadCount { channel_id: string; unread_count: number }
export interface UnreadResponse { counts: UnreadCount[] }
export interface ReadResponse { channel_id: string; last_read_message_id: string | null; unread_count: number }
/** Payload of an `unread.changed` realtime event. */
export interface UnreadChangedPayload { user_id?: string; unread_count?: number }

@Injectable({ providedIn: 'root' })
export class UnreadMessageIndicatorsApiService {
  private api = inject(ApiClient);
  private base = inject(BaseApiClient, { optional: true });

  get mock(): boolean {
    return this.base instanceof MockApiClient;
  }

  private call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    if (this.base instanceof MockApiClient) {
      ensureUnreadMock(this.base, method, `/api/${path}`);
      return this.base.request<T>(`/api/${path}`, { method, body });
    }
    if (method === 'GET') return this.api.get<T>(path);
    return this.api.post<T>(path, body);
  }

  unread(projectId: string): Promise<UnreadResponse> {
    return this.call('GET', `projects/${encodeURIComponent(projectId)}/unread`);
  }

  markRead(channelId: string): Promise<ReadResponse> {
    return this.call('POST', `channels/${encodeURIComponent(channelId)}/read`, {});
  }

  /** Server-Sent Events stream (GET /api/realtime/socket) for one channel; null in mock mode. */
  openStream(channelId: string): EventSource | null {
    if (this.mock || typeof EventSource === 'undefined') return null;
    return new EventSource(this.api.url(`realtime/socket?channel_id=${encodeURIComponent(channelId)}`), {
      withCredentials: true,
    });
  }
}
