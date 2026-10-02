import { Injectable, inject } from '@angular/core';
import { ApiClient } from '../../shared/api/api-client.service';

export interface Channel {
  id: string;
  projectId: string;
  kind: string;
  name: string;
  internalOnly: boolean;
  status: string;
  createdAt: string;
}

export interface ChannelMessage {
  id: string;
  channelId: string;
  authorId: string;
  authorName: string;
  bodyHtml: string;
  attachments: { id: string; fileId: string }[];
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
}

export interface RealtimeEnvelope {
  type: 'message.created' | 'message.updated' | 'message.deleted' | 'channel.created';
  channelId: string;
  projectId: string;
  payload: unknown;
}

/** Relative so it resolves against <base href>, like ApiClient's 'api' base. */
export const REALTIME_SOCKET_URL = 'api/realtime/socket';

@Injectable({ providedIn: 'root' })
export class ChannelsApi {
  private api = inject(ApiClient);

  listChannels(projectId: string): Promise<Channel[]> {
    return this.api.get<Channel[]>(`projects/${encodeURIComponent(projectId)}/channels`);
  }

  createChannel(projectId: string, name: string, internalOnly: boolean): Promise<Channel> {
    return this.api.post<Channel>(`projects/${encodeURIComponent(projectId)}/channels`, { name, internalOnly });
  }

  listMessages(channelId: string): Promise<ChannelMessage[]> {
    return this.api.get<ChannelMessage[]>(`channels/${encodeURIComponent(channelId)}/messages`);
  }

  postMessage(channelId: string, bodyHtml: string): Promise<ChannelMessage> {
    return this.api.post<ChannelMessage>(`channels/${encodeURIComponent(channelId)}/messages`, { bodyHtml });
  }

  editMessage(messageId: string, bodyHtml: string): Promise<ChannelMessage> {
    return this.api.patch<ChannelMessage>(`messages/${encodeURIComponent(messageId)}`, { bodyHtml });
  }

  deleteMessage(messageId: string): Promise<void> {
    return this.api.delete<void>(`messages/${encodeURIComponent(messageId)}`);
  }
}
