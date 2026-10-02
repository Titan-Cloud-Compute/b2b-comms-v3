import { UnauthorizedException } from '@nestjs/common';
import type { User } from '@prisma/client';

export interface UserIdentity {
  id: string;
  email: string;
  name: string | null;
  displayName: string | null;
  role: string;
  organizationId: string | null;
  active: boolean;
}

/** Returns true when the user account is active (active !== false). */
export function isActiveUser(u: Pick<User, 'active'>): boolean {
  return u.active !== false;
}

/**
 * Throws a generic UnauthorizedException when the user is inactive so the
 * caller never reveals which accounts exist (OWASP Authentication Cheat Sheet).
 */
export function assertActiveUser(u: Pick<User, 'active'>): void {
  if (!isActiveUser(u)) {
    throw new UnauthorizedException('invalid credentials');
  }
}

/**
 * Converts a Prisma User row to a safe public identity object.
 * Prefers display_name over name (the snake_case columns map directly from
 * the shared data model); falls back to null when both are absent.
 */
export function toIdentity(u: User): UserIdentity {
  const displayName = u.display_name ?? u.name ?? null;
  return {
    id: u.id,
    email: u.email,
    name: displayName,
    displayName,
    role: u.role,
    organizationId: u.organization_id ?? null,
    active: isActiveUser(u),
  };
}
