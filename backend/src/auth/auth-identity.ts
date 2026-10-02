import { UnauthorizedException } from '@nestjs/common';
import type { User } from '@prisma/client';

/**
 * The subset of user fields returned from every identity endpoint.
 * Fields that could leak internal data (passwordHash, quotaResetAt, etc.)
 * are deliberately excluded.
 */
export interface UserIdentity {
  id: string;
  email: string;
  /** Resolved display name: display_name ?? name ?? null. */
  name: string | null;
  /** Same resolution as `name`; kept separate so callers can alias cleanly. */
  displayName: string | null;
  role: string;
  organizationId: string | null;
  active: boolean;
}

/**
 * Returns true when the account is active (active === null/undefined also
 * counts as active — the field was added after initial users were seeded).
 */
export function isActiveUser(u: { active?: boolean | null }): boolean {
  return u.active !== false;
}

/**
 * Throws UnauthorizedException('invalid credentials') when the account is
 * deactivated.  Uses the same generic message as a bad password so the response
 * does not reveal which accounts exist (OWASP Authentication Cheat Sheet).
 */
export function assertActiveUser(u: { active?: boolean | null }): void {
  if (!isActiveUser(u)) {
    throw new UnauthorizedException('invalid credentials');
  }
}

/**
 * Map a Prisma User row to the safe identity shape returned by every /me
 * and login endpoint.  Picks only the seven fields the client needs.
 */
export function toIdentity(u: User): UserIdentity {
  const displayName = (u.display_name ?? u.name) ?? null;
  return {
    id: u.id,
    email: u.email,
    name: displayName,
    displayName,
    role: u.role as string,
    organizationId: u.organization_id ?? null,
    active: isActiveUser(u),
  };
}
