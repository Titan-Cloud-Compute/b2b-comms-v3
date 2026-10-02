import { inject } from '@angular/core';
import { CanActivateChildFn, CanActivateFn, Router } from '@angular/router';
import { AuthService, User } from './auth.service';
import { AuthApi } from './api/auth-api.service';
import { PREVIEW_MODE } from './preview/preview-mode';

const ROLES: readonly User['role'][] = ['USER', 'MANAGER', 'ADMIN', 'SUPER_ADMIN'];

/**
 * Session guard for the authenticated shell. Trusts the in-memory user first;
 * otherwise asks the server (`GET users/me`, cookie-authenticated). With no
 * session it bounces to /login carrying the requested URL as `returnUrl`.
 */
export const authGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const authApi = inject(AuthApi);
  // Preview builds have no backend: the cached (preview) user is the session.
  if (PREVIEW_MODE && auth.user()) return true;
  if (!PREVIEW_MODE) {
    // Always confirm the session server-side; a cached localStorage user
    // outlives logout-in-another-tab and expired cookies.
    const me = (await authApi.me()) as
      | { id: string; email: string; role?: string; name?: string; displayName?: string }
      | null;
    if (me && me.id && me.email) {
      const role = ROLES.includes(me.role as User['role']) ? (me.role as User['role']) : 'USER';
      auth.setUser({
        id: me.id,
        email: me.email,
        name: me.displayName || me.name || me.email.split('@')[0],
        role,
      });
      return true;
    }
  }
  auth.setUser(null);
  return router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
};

export const authChildGuard: CanActivateChildFn = (route, state) => authGuard(route, state);
