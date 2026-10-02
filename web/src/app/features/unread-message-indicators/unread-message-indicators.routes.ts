import { inject } from '@angular/core';
import { CanMatchFn, Routes, UrlSegment } from '@angular/router';
import { UnreadMessageIndicatorsApiService } from './unread-message-indicators-api.service';

/**
 * Fires POST /api/channels/:id/read whenever a channel or question chat is opened,
 * however the user got there. It never matches, so the router falls through to the
 * owning sibling's route and its component loads unchanged.
 */
const markReadOnOpen: CanMatchFn = (_route, segments: UrlSegment[]) => {
  const channelId = segments[3]?.path;
  if (channelId) {
    void inject(UnreadMessageIndicatorsApiService)
      .markRead(channelId)
      .catch(() => undefined);
  }
  return false;
};

/** Session-only routes for the Unread Message Indicators story. */
export const UNREAD_MESSAGE_INDICATORS_ROUTES: Routes = [
  {
    // Project page with the channel list + unread bubbles embedded.
    path: 'projects/:id',
    pathMatch: 'full',
    // FEATURE_ROUTES spreads this file first: leave static siblings like /projects/new alone.
    canMatch: [(_r: unknown, segments: UrlSegment[]) => segments[1]?.path !== 'new'],
    loadComponent: () => import('./project-with-unread.component').then((m) => m.ProjectWithUnreadComponent),
  },
  {
    path: 'projects/:id/channels',
    pathMatch: 'full',
    loadComponent: () => import('./unread-channel-list.component').then((m) => m.UnreadChannelListComponent),
  },
  { path: 'projects/:id/channels/:channelId', pathMatch: 'full', canMatch: [markReadOnOpen], children: [] },
  { path: 'projects/:id/questions/:channelId', pathMatch: 'full', canMatch: [markReadOnOpen], children: [] },
];
