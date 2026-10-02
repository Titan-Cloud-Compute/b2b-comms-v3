import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

/**
 * Server-checked route guard for the authenticated shell (full_auth).
 *
 * Asks the backend (GET api/users/me, cookie session) whether a session
 * exists — the cached localStorage user alone is never trusted. With no
 * session the visitor is sent to /login carrying the interrupted destination
 * as `returnUrl`, so the login page can resume there after sign-in.
 */
export const authGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (await auth.verifySession()) return true;
  const returnUrl = state.url && state.url !== '/' ? state.url : undefined;
  return router.createUrlTree(['/login'], returnUrl ? { queryParams: { returnUrl } } : {});
};

/**
 * Root ('/') entry: never renders a page of its own. Signed-in users land on
 * /projects, everyone else on /login.
 */
export const rootRedirectGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return router.createUrlTree([(await auth.verifySession()) ? '/projects' : '/login']);
};
