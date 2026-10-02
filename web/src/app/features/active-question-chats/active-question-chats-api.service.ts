import { Injectable, inject } from '@angular/core';
import { ApiClient } from '../../shared/api/api-client.service';
import { ApiClient as BaseApiClient, MockApiClient } from '../../shared/api/api-client';
import { ensureActiveQuestionChatsMock } from './active-question-chats-mocks';

// Contract types for the Active Question Chats story (mirrors the card's endpoint contract).
export interface QuestionItem { id: string; name: string; status: string; resolved_sides: string; unread_count: number }
export interface QuestionList { items: QuestionItem[] }
export interface CreatedQuestion { id: string; name: string; kind: string; status: string; first_message_id: string }
export interface QuestionResolution { id: string; status: string; resolved_sides: string }

@Injectable({ providedIn: 'root' })
export class ActiveQuestionChatsApiService {
  private api = inject(ApiClient);
  private base = inject(BaseApiClient, { optional: true });

  private call<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
    if (this.base instanceof MockApiClient) {
      ensureActiveQuestionChatsMock(this.base, method, `/api/${path}`);
      return this.base.request<T>(`/api/${path}`, { method, body });
    }
    if (method === 'GET') return this.api.get<T>(path);
    if (method === 'DELETE') return this.api.delete<T>(path);
    return this.api.post<T>(path, body);
  }

  list(projectId: string): Promise<QuestionList> {
    return this.call('GET', `projects/${encodeURIComponent(projectId)}/questions`);
  }
  create(projectId: string, title: string, bodyHtml: string): Promise<CreatedQuestion> {
    return this.call('POST', `projects/${encodeURIComponent(projectId)}/questions`, { title, body_html: bodyHtml });
  }
  resolve(questionId: string): Promise<QuestionResolution> {
    return this.call('POST', `questions/${encodeURIComponent(questionId)}/resolve`);
  }
  withdraw(questionId: string): Promise<QuestionResolution> {
    return this.call('DELETE', `questions/${encodeURIComponent(questionId)}/resolve`);
  }
}
