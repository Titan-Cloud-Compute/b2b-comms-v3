import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

/**
 * full_auth guard for every non-public route. A locally cached user is NOT
 * enough: the session is re-checked against the server (AuthService
 * .verifySession) so an expired cookie or a deactivated account is bounced
 * to /login, carrying the interrupted URL as `returnUrl`.
 */
export const authGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const toLogin = () =>
    router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });

  if (!auth.user()) return toLogin();
  const ok = await auth.verifySession();
  return ok ? true : toLogin();
};

/**
 * Role check for admin screens: non-admins are sent to the signed-in home.
 * Runs after authGuard (applied on the parent layout route).
 */
export const adminGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (!auth.user()) return router.createUrlTree(['/login']);
  if (auth.hasAdminRole()) return true;
  const hasProjects = router.config.some((r) => r.path === 'projects');
  return router.createUrlTree([hasProjects ? '/projects' : '/dashboard']);
};

/**
 * Root ('/') redirect by session: signed-in users go to the projects home
 * (falling back to the dashboard when the projects feature is not
 * registered), everyone else to /login.
 */
export const rootRedirectGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (auth.user() && (await auth.verifySession())) {
    const hasProjects = router.config.some((r) => r.path === 'projects');
    return router.createUrlTree([hasProjects ? '/projects' : '/dashboard']);
  }
  return router.createUrlTree(['/login']);
};
