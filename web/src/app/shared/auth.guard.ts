import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService, User } from './auth.service';
import { PREVIEW_MODE } from './preview/preview-mode';

const ROLES: readonly User['role'][] = ['USER', 'MANAGER', 'ADMIN', 'SUPER_ADMIN'];

function meUrl(): string {
  try {
    return new URL('api/users/me', document.baseURI).toString();
  } catch {
    return 'api/users/me';
  }
}

/**
 * Guards the authenticated shell and every feature route. The server session
 * (cookie) is the source of truth: a signed-out visitor is sent to /login with
 * the requested URL carried as `returnUrl`.
 */
export const authGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (PREVIEW_MODE) return true;

  try {
    const res = await fetch(meUrl(), { credentials: 'include' });
    if (res.ok) {
      const body = (await res.json().catch(() => null)) as Partial<User> | null;
      if (body && typeof body.id === 'string' && body.id && ROLES.includes(body.role as User['role'])) {
        if (body.active !== false) {
          const current = auth.user();
          auth.setUser({
            ...(current && current.id === body.id ? current : {}),
            ...body,
            name: typeof body.name === 'string' && body.name ? body.name : (body.email ?? ''),
          } as User);
          return true;
        }
      }
    }
  } catch {
    /* network failure → treat as signed out */
  }

  auth.setUser(null);
  return router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
};
