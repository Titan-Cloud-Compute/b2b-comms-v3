import { Injectable, inject } from '@angular/core';
import { ApiClient } from '../../shared/api/api-client.service';

export type QuestionSide = 'internal' | 'external';

export interface Question {
  id: string;
  projectId: string;
  kind: string;
  name: string;
  status: string;
  resolvedSides: string[];
  mySide: QuestionSide;
  createdBy: string;
  createdAt: string;
}

/** Active Questions API. Thread messages go through ChannelsApi (/api/channels/:id/messages). */
@Injectable({ providedIn: 'root' })
export class QuestionsApi {
  private api = inject(ApiClient);

  list(projectId: string): Promise<Question[]> {
    return this.api.get<Question[]>(`projects/${encodeURIComponent(projectId)}/questions`);
  }

  create(projectId: string, title: string, bodyHtml: string): Promise<Question> {
    return this.api.post<Question>(`projects/${encodeURIComponent(projectId)}/questions`, { title, bodyHtml });
  }

  resolve(questionId: string): Promise<Question> {
    return this.api.post<Question>(`questions/${encodeURIComponent(questionId)}/resolve`, {});
  }

  withdraw(questionId: string): Promise<Question> {
    return this.api.delete<Question>(`questions/${encodeURIComponent(questionId)}/resolve`);
  }
}
