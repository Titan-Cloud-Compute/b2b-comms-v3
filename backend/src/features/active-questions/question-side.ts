/**
 * Determines which resolution side a user belongs to based on their
 * organization's is_internal flag.
 *
 * A user whose organization has is_internal === false is 'external'.
 * Every other user — including those with no organization — is 'internal'.
 */
export interface OrgLike {
  is_internal: boolean;
}

export interface UserWithOrg {
  organization?: OrgLike | null;
}

export function resolveSide(user: UserWithOrg): 'internal' | 'external' {
  if (user.organization && user.organization.is_internal === false) {
    return 'external';
  }
  return 'internal';
}
