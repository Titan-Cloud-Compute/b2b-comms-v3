import { Routes } from '@angular/router';

/** Session-only routes for the Active Question Chats story. */
export const ACTIVE_QUESTION_CHATS_ROUTES: Routes = [
  {
    path: 'projects/:id/questions/:channelId',
    loadComponent: () => import('./question.component').then((m) => m.QuestionComponent),
  },
];
