import { Injectable, inject } from '@angular/core';
import { ApiClient } from '../../shared/api/api-client.service';
import { Reference } from './reference.types';

export interface CreateReferencePayload {
  file_version_id: string;
  page_number: number;
  annotations: Reference['annotations'];
}

@Injectable({ providedIn: 'root' })
export class ReferencesApiService {
  private api = inject(ApiClient);

  getReference(referenceId: string): Promise<Reference> {
    return this.api.get<Reference>(`references/${referenceId}`);
  }

  createReference(messageId: string, payload: CreateReferencePayload): Promise<Reference> {
    return this.api.post<Reference>(`messages/${messageId}/reference`, payload);
  }

  updateReference(referenceId: string, annotations: Reference['annotations']): Promise<Reference> {
    return this.api.put<Reference>(`references/${referenceId}`, { annotations });
  }

  deleteReference(referenceId: string): Promise<void> {
    return this.api.delete<void>(`references/${referenceId}`);
  }
}
