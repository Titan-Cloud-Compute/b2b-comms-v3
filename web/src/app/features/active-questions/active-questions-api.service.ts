import { Injectable, inject } from '@angular/core';
import { ApiClient } from '../../shared/api/api-client.service';
import { MessageDto, QuestionDto } from './active-questions.types';

@Injectable({ providedIn: 'root' })
export class ActiveQuestionsApiService {
  private api = inject(ApiClient);

  list(projectId: string): Promise<QuestionDto[]> {
    return this.api.get<QuestionDto[]>(`projects/${encodeURIComponent(projectId)}/questions`);
  }

  create(projectId: string, body: { title: string; body_html: string }): Promise<QuestionDto> {
    return this.api.post<QuestionDto>(`projects/${encodeURIComponent(projectId)}/questions`, body);
  }

  resolve(id: string): Promise<QuestionDto> {
    return this.api.post<QuestionDto>(`questions/${encodeURIComponent(id)}/resolve`);
  }

  withdraw(id: string): Promise<QuestionDto> {
    return this.api.delete<QuestionDto>(`questions/${encodeURIComponent(id)}/resolve`);
  }

  messages(channelId: string): Promise<MessageDto[]> {
    return this.api.get<MessageDto[]>(`channels/${encodeURIComponent(channelId)}/messages`);
  }

  post(channelId: string, body_html: string): Promise<MessageDto> {
    return this.api.post<MessageDto>(`channels/${encodeURIComponent(channelId)}/messages`, { body_html });
  }
}
