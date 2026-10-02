/**
 * Pure post-login route resolver (no Angular imports so it can be unit
 * tested with plain node). Every role lands on the project list at
 * /projects; an internal returnUrl (from the auth guard) wins when present.
 */
export type PostLoginRole = 'USER' | 'MANAGER' | 'ADMIN' | 'SUPER_ADMIN' | string;

export const PROJECTS_HOME = '/projects';

export function postLoginRoute(_role: PostLoginRole, returnUrl?: string | null): string {
  if (
    returnUrl &&
    returnUrl.startsWith('/') &&
    !returnUrl.startsWith('//') &&
    !returnUrl.startsWith('/login')
  ) {
    return returnUrl;
  }
  return PROJECTS_HOME;
}
