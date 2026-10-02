import { UnauthorizedException } from '@nestjs/common';

/** The subset of the auth User row the identity is built from. */
export interface IdentitySource {
  id: string;
  email: string;
  name?: string | null;
  display_name?: string | null;
  role: string;
  organization_id?: string | null;
  active?: boolean | null;
}

/** The real identity returned by login, GET /api/auth/me and GET /api/users/me. */
export interface AuthIdentity {
  id: string;
  email: string;
  name: string | null;
  displayName: string | null;
  role: string;
  organizationId: string | null;
  active: boolean;
}

/** `active` is nullable for rows predating the column: only an explicit false deactivates. */
export function isActiveUser(user: Pick<IdentitySource, 'active'>): boolean {
  return user.active !== false;
}

/** Refuse a deactivated account with the same 401 as bad credentials. */
export function assertActiveUser(user: Pick<IdentitySource, 'active'>): void {
  if (!isActiveUser(user)) throw new UnauthorizedException('account deactivated');
}

export function toIdentity(user: IdentitySource): AuthIdentity {
  const displayName = user.display_name ?? user.name ?? null;
  return {
    id: user.id,
    email: user.email,
    name: displayName,
    displayName,
    role: user.role,
    organizationId: user.organization_id ?? null,
    active: isActiveUser(user),
  };
}
