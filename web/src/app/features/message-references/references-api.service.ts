import { Injectable, inject } from '@angular/core';
import { ApiClient } from '../../shared/api/api-client.service';
import { Reference, Annotation } from './reference.types';

@Injectable({ providedIn: 'root' })
export class ReferencesApiService {
  private api = inject(ApiClient);

  getReference(id: string): Promise<Reference> {
    return this.api.get<Reference>(`references/${id}`);
  }

  updateReference(id: string, annotations: Annotation[]): Promise<Reference> {
    return this.api.put<Reference>(`references/${id}`, { annotations });
  }

  deleteReference(id: string): Promise<void> {
    return this.api.delete<void>(`references/${id}`);
  }

  createReference(
    messageId: string,
    data: { fileVersionId: string; pageNumber: number; annotations: Annotation[] },
  ): Promise<Reference> {
    return this.api.post<Reference>(`messages/${messageId}/reference`, data);
  }
}
