import { ApiError } from '../../shared/api/api-errors';

/** Human message for a failed projects call (never echoes a raw "Not Found"). */
export function projectErrorMessage(err: unknown, fallback: string): string {
  const status = (err as { status?: number } | null)?.status;
  if (status === 403) return 'You do not have access to this project.';
  if (status === 404) return 'This project is unavailable.';
  if (err instanceof ApiError) {
    const raw: unknown = (err.body as { message?: unknown } | undefined)?.message;
    const msg = Array.isArray(raw) ? raw.join(', ') : raw;
    if (typeof msg === 'string' && msg && !/not found/i.test(msg)) return msg;
  }
  return fallback;
}
