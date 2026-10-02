import { Routes } from '@angular/router';

/** Session-only routes for the General Channels story. */
export const GENERAL_CHANNELS_ROUTES: Routes = [
  {
    path: 'projects/:id/channels/:channelId',
    loadComponent: () => import('./channel.component').then((m) => m.ChannelComponent),
  },
];
