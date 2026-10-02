/**
 * DTO returned by every active-questions endpoint.
 *
 * resolvedSides lists which sides ('internal' | 'external') have already
 * marked the question resolved.  Both sides present → status 'resolved'.
 * mySide is the caller's own side, derived from their organization.
 */
export interface QuestionDto {
  id: string;
  projectId: string;
  title: string;
  status: string;
  createdBy: string;
  createdAt: Date;
  resolvedSides: ('internal' | 'external')[];
  mySide: 'internal' | 'external';
}
