import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

/**
 * Server-checked route guard. Every guarded navigation asks the backend
 * (GET /api/users/me) whether the session cookie is valid; with no session the
 * visitor is sent to /login carrying a returnUrl so the login form can send
 * them back after signing in.
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

/**
 * Role guard for admin-only routes. Assumes authGuard already ran and the
 * user is authenticated. Bounces non-admins to /projects if that route exists,
 * else /dashboard.
 */
export const adminGuard: CanActivateFn = (_route, _state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (auth.hasAdminRole()) return true;
  const hasProjects = router.config.some(r => r.path === 'projects');
  return router.createUrlTree([hasProjects ? '/projects' : '/dashboard']);
};
