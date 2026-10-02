import { Injectable, inject } from '@angular/core';
import { ApiClient } from '../../shared/api/api-client.service';
import { QuestionDto, MessageDto } from './active-questions.types';

@Injectable({ providedIn: 'root' })
export class ActiveQuestionsApiService {
  private api = inject(ApiClient);

  list(projectId: string): Promise<QuestionDto[]> {
    return this.api.get<QuestionDto[]>(`projects/${projectId}/questions`);
  }

  create(projectId: string, payload: { title: string; body_html: string }): Promise<QuestionDto> {
    return this.api.post<QuestionDto>(`projects/${projectId}/questions`, payload);
  }

  resolve(id: string): Promise<QuestionDto> {
    return this.api.post<QuestionDto>(`questions/${id}/resolve`);
  }

  withdraw(id: string): Promise<QuestionDto> {
    return this.api.delete<QuestionDto>(`questions/${id}/resolve`);
  }

  messages(channelId: string): Promise<MessageDto[]> {
    return this.api.get<MessageDto[]>(`channels/${channelId}/messages`);
  }

  postMessage(channelId: string, bodyHtml: string): Promise<MessageDto> {
    return this.api.post<MessageDto>(`channels/${channelId}/messages`, { bodyHtml });
  }
}
