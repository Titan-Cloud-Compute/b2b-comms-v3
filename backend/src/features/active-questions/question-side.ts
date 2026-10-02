/**
 * Determines the side a user belongs to for active-question resolution.
 *
 * A user whose organization has is_internal === false is 'external'.
 * Every other user (internal org, or no org at all) is 'internal'.
 */
export function resolveSide(orgIsInternal: boolean | null | undefined): 'internal' | 'external' {
  return orgIsInternal === false ? 'external' : 'internal';
}
