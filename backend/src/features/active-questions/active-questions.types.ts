/**
 * Shared DTO for an active-question channel.
 * Returned by every active-questions endpoint.
 */
export interface QuestionDto {
  id: string;
  projectId: string;
  title: string;
  status: string;
  createdBy: string;
  createdAt: Date;
  /** Which sides have marked the question resolved. */
  resolvedSides: ('internal' | 'external')[];
  /** The calling user's side ('internal' or 'external'). */
  mySide: 'internal' | 'external';
}
