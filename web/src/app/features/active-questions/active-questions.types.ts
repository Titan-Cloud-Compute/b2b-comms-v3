export interface QuestionDto {
  id: string;
  projectId: string;
  title: string;
  status: 'open' | 'resolved';
  createdBy: string;
  createdAt: string;
  resolvedSides: string[];
  mySide: string;
}

export interface MessageDto {
  id: string;
  channelId: string;
  authorId: string;
  bodyHtml: string;
  createdAt: string;
}
