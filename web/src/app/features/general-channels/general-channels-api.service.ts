import { Injectable, inject } from '@angular/core';
import { ApiClient } from '../../shared/api/api-client.service';
import { ApiClient as BaseApiClient, MockApiClient } from '../../shared/api/api-client';
import { ensureGeneralChannelsMock } from './general-channels-mocks';

// Contract types for the General Channels story (mirrors the card's endpoint
// contract; @contracts has no web-side slug yet).
export interface GeneralChannel { id: string; name: string; internal_only: boolean; unread_count: number }
export interface QuestionChannel { id: string; name: string; status: string; unread_count: number }
export interface ChannelList { general: GeneralChannel[]; questions: QuestionChannel[] }
export interface MessageAttachment { file_id: string; name: string }
export interface ChannelMessage {
  id: string;
  channel_id?: string;
  author: { id: string; display_name: string };
  body_html: string;
  attachments: MessageAttachment[];
  reference_id: string | null;
  edited_at: string | null;
  created_at: string | null;
}
export interface MessagePage { items: ChannelMessage[]; next_cursor: string | null }
export interface CreatedMessage { id: string; channel_id: string; author_id: string; body_html: string; created_at: string }
export interface RealtimeEvent { type: string; channel_id: string; payload: unknown }

/** HTTP status of a failed call; 0 means the network/server could not be reached. */
export function errorStatus(err: unknown): number {
  const s = (err as { status?: unknown })?.status;
  return typeof s === 'number' ? s : 0;
}

export function errorMessage(err: unknown): string {
  const e = err as { message?: string; body?: { message?: unknown } };
  const m = e?.body?.message;
  return (Array.isArray(m) ? m.join(', ') : (m as string | undefined)) || e?.message || 'Request failed';
}

@Injectable({ providedIn: 'root' })
export class GeneralChannelsApiService {
  private api = inject(ApiClient);
  private base = inject(BaseApiClient, { optional: true });

  get mock(): boolean {
    return this.base instanceof MockApiClient;
  }

  private call<T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
    if (this.base instanceof MockApiClient) {
      ensureGeneralChannelsMock(this.base, method, `/api/${path}`);
      return this.base.request<T>(`/api/${path}`, { method, body });
    }
    if (method === 'GET') return this.api.get<T>(path);
    if (method === 'PATCH') return this.api.patch<T>(path, body);
    if (method === 'DELETE') return this.api.delete<T>(path);
    return this.api.post<T>(path, body);
  }

  channels(projectId: string): Promise<ChannelList> {
    return this.call('GET', `projects/${encodeURIComponent(projectId)}/channels`);
  }
  createChannel(projectId: string, name: string, internalOnly: boolean): Promise<GeneralChannel> {
    return this.call('POST', `projects/${encodeURIComponent(projectId)}/channels`, { name, internal_only: internalOnly });
  }
  messages(channelId: string, cursor?: string | null): Promise<MessagePage> {
    const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    return this.call('GET', `channels/${encodeURIComponent(channelId)}/messages${qs}`);
  }
  send(channelId: string, bodyHtml: string, fileIds: string[]): Promise<CreatedMessage> {
    return this.call('POST', `channels/${encodeURIComponent(channelId)}/messages`, { body_html: bodyHtml, file_ids: fileIds });
  }
  edit(messageId: string, bodyHtml: string): Promise<{ id: string; body_html: string; edited_at: string }> {
    return this.call('PATCH', `messages/${encodeURIComponent(messageId)}`, { body_html: bodyHtml });
  }
  remove(messageId: string): Promise<unknown> {
    return this.call('DELETE', `messages/${encodeURIComponent(messageId)}`);
  }
  /** Uploads one attachment through the File Explorer endpoint; returns its file id. */
  async uploadAttachment(projectId: string, file: File): Promise<{ id: string; name: string }> {
    const path = `projects/${encodeURIComponent(projectId)}/files`;
    if (this.mock) return { id: `mock-${file.name}`, name: file.name };
    const res = await this.api.upload<{ items?: { id: string; name: string }[] }>(path, file, {}, 'files');
    const item = res?.items?.[0];
    if (!item) throw new Error('Upload failed');
    return { id: item.id, name: item.name ?? file.name };
  }
  /** Server-Sent Events stream for one channel; null in mock mode. */
  openStream(channelId: string): EventSource | null {
    if (this.mock || typeof EventSource === 'undefined') return null;
    return new EventSource(this.api.url(`realtime/socket?channel_id=${encodeURIComponent(channelId)}`), {
      withCredentials: true,
    });
  }
}
