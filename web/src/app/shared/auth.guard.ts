import { inject } from '@angular/core';
import { CanActivateFn, Router, Routes } from '@angular/router';
import { AuthService } from './auth.service';

/**
 * Server-checked route guard. Every guarded navigation asks the backend
 * (GET /api/users/me) whether the session cookie is valid; with no session
 * the visitor is sent to /login carrying a returnUrl so the login form can
 * send them back after signing in.
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

/** Looks recursively for a route with the given path. */
function findRoute(config: Routes, path: string): boolean {
  return config.some(r =>
    r.path === path || (Array.isArray(r.children) && findRoute(r.children, path))
  );
}

/**
 * Admin-only route guard. Must be applied AFTER authGuard (the user is already
 * authenticated at this point). A non-admin is redirected to /projects when
 * that route is registered, otherwise to /dashboard.
 */
export const adminGuard: CanActivateFn = (_route, _state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (auth.hasAdminRole()) return true;
  const dest = findRoute(router.config, 'projects') ? '/projects' : '/dashboard';
  return router.createUrlTree([dest]);
};
