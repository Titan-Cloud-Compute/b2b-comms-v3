import { Routes } from '@angular/router';

/** Session-only routes for the Unread Message Indicators story. */
export const UNREAD_MESSAGE_INDICATORS_ROUTES: Routes = [
  {
    path: 'projects/:id/channels',
    pathMatch: 'full',
    loadComponent: () => import('./unread-channel-list.component').then((m) => m.UnreadChannelListComponent),
  },
];
