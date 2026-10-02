import { Routes } from '@angular/router';

/**
 * Public (signed-out) routes for the Authentication and Roles story.
 * These must NOT sit under the guarded FEATURE_ROUTES parent: invited
 * contacts have no session yet.
 */
export const AUTHENTICATION_AND_ROLES_PUBLIC_ROUTES: Routes = [
  {
    path: 'accept-invite/:token',
    loadComponent: () =>
      import('./accept-invite.component').then((m) => m.AcceptInviteComponent),
    data: { hideSupportFooter: true },
  },
];
