import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

/**
 * Server-checked route guard. Every guarded navigation asks the backend
 * (GET /api/auth/me, falling back to /api/users/me) whether the session cookie
 * is valid; with no session the visitor is sent to /login carrying a returnUrl
 * so the login form can send them back after signing in.
 */
export const authGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (await auth.verifySession()) return true;
  const returnUrl = state.url;
  return router.createUrlTree(
    ['/login'],
    returnUrl && returnUrl !== '/' ? { queryParams: { returnUrl } } : {},
  );
};
