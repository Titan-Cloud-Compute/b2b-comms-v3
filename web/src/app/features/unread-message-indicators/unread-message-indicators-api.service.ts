import { Injectable, inject } from '@angular/core';
import { ApiClient } from '../../shared/api/api-client.service';
import { ApiClient as BaseApiClient, MockApiClient } from '../../shared/api/api-client';
import { ensureUnreadMock } from './unread-message-indicators-mocks';

// Contract types for the Unread Message Indicators story.
export interface UnreadCount { channel_id: string; unread_count: number }
export interface UnreadCounts { counts: UnreadCount[] }
export interface ReadResult { channel_id: string; last_read_message_id: string | null; unread_count: number }
export interface ListedChannel { id: string; name: string; internal_only?: boolean; status?: string }
export interface ProjectChannels { general: ListedChannel[]; questions: ListedChannel[] }
export interface UnreadChangedEvent { type: string; channel_id: string; payload?: { project_id?: string | null; unread_count?: number } }

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
    return method === 'GET' ? this.api.get<T>(path) : this.api.post<T>(path, body ?? {});
  }

  /** Channel names (General Channels endpoint). */
  channels(projectId: string): Promise<ProjectChannels> {
    return this.call('GET', `projects/${encodeURIComponent(projectId)}/channels`);
  }
  unread(projectId: string): Promise<UnreadCounts> {
    return this.call('GET', `projects/${encodeURIComponent(projectId)}/unread`);
  }
  markRead(channelId: string): Promise<ReadResult> {
    return this.call('POST', `channels/${encodeURIComponent(channelId)}/read`);
  }
  /** Per-user Server-Sent Events stream of unread.changed; null in mock mode. */
  openStream(): EventSource | null {
    if (this.mock || typeof EventSource === 'undefined') return null;
    return new EventSource(this.api.url('realtime/unread'), { withCredentials: true });
  }
}
