import { Routes } from '@angular/router';

/**
 * Feature route registry.
 *
 * Each story appends its Angular routes to this array.
 * app.routes.ts spreads FEATURE_ROUTES before the wildcard catch-all so new
 * feature routes are picked up automatically.
 *
 * Example (in features/my-feature/my-feature.routes.ts):
 *
 *   import { FEATURE_ROUTES } from '../index';
 *   FEATURE_ROUTES.push({ path: 'my-feature', loadComponent: () => ... });
 *
 * Or add routes here directly.
 */
import { PROJECTS_AND_EXTERNAL_ORGANIZATION_SPACES_ROUTES } from './projects-and-external-organization-spaces/projects-and-external-organization-spaces.routes';

import { FILE_EXPLORER_ROUTES } from './file-explorer/file-explorer.routes';
import { GENERAL_CHANNELS_ROUTES } from './general-channels/general-channels.routes';
// Active Question Chats: projects/:id/questions/:channelId
import { ACTIVE_QUESTION_CHATS_ROUTES } from './active-question-chats/active-question-chats.routes';
// Message Reference and Annotation: projects/:id/references/new, projects/:id/references/:referenceId
import { MESSAGE_REFERENCE_AND_ANNOTATION_ROUTES } from './message-reference-and-annotation/message-reference-and-annotation.routes';

// Unread Message Indicators: projects/:id/channels (channel list with unread bubbles)
import { UNREAD_MESSAGE_INDICATORS_ROUTES } from './unread-message-indicators/unread-message-indicators.routes';

export const FEATURE_ROUTES: Routes = [
  ...UNREAD_MESSAGE_INDICATORS_ROUTES,
  ...MESSAGE_REFERENCE_AND_ANNOTATION_ROUTES,
  ...GENERAL_CHANNELS_ROUTES,
  ...ACTIVE_QUESTION_CHATS_ROUTES,
  ...FILE_EXPLORER_ROUTES,
  ...PROJECTS_AND_EXTERNAL_ORGANIZATION_SPACES_ROUTES,
];
