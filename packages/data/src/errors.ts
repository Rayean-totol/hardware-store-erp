/**
 * Typed errors from the data layer. `code` is stable and translated by the UI
 * (`errors.<code>`, falling back to the raw message for unknown codes).
 * Errors are never swallowed: every repository method either returns data or throws.
 */
export class DataError extends Error {
  readonly code: string;
  readonly detail: string | null;
  override readonly cause?: unknown;

  constructor(code: string, message: string, detail: string | null = null, cause?: unknown) {
    super(message);
    this.name = 'DataError';
    this.code = code;
    this.detail = detail;
    this.cause = cause;
  }
}

interface PostgrestLikeError {
  code?: string;
  message?: string;
  details?: string | null;
  hint?: string | null;
}

/** Codes raised by app.fail() in the migrations. Anything else is mapped generically. */
const APP_CODE = /^[a-z_]+(\.[a-z_]+)*$/;
const NETWORK_MESSAGE = /failed to fetch|fetch failed|networkerror|network request failed|load failed/i;

export function toDataError(error: unknown): DataError {
  if (error instanceof DataError) return error;

  if (error instanceof TypeError && /fetch|network/i.test(error.message)) {
    return new DataError('network', error.message, null, error);
  }

  const e = (error ?? {}) as PostgrestLikeError;
  const message = e.message ?? String(error);
  const detail = e.details ? String(e.details) : null;

  // supabase-js reports fetch failures as error objects without a Postgres code.
  if (!e.code && NETWORK_MESSAGE.test(message)) {
    return new DataError('network', message, detail, error);
  }

  switch (e.code) {
    case 'P0001':
      return new DataError(APP_CODE.test(message) ? message : 'unknown', message, detail, error);
    case '42501':
      return new DataError('forbidden', message, detail, error);
    case '23505':
      return new DataError('conflict.unique', message, detail, error);
    case '23503':
      return new DataError('reference_missing', message, detail, error);
    case '23514':
      return new DataError('validation', message, detail, error);
    case 'PGRST301':
    case 'PGRST302':
    case 'PGRST303':
      return new DataError('auth.session_expired', message, detail, error);
    case 'PGRST116':
      return new DataError('not_found', message, detail, error);
    default:
      return new DataError('unknown', message, detail, error);
  }
}

/** Unwrap a supabase-js `{ data, error }` result. */
export function unwrap<T>(result: { data: T | null; error: unknown }): T {
  if (result.error) throw toDataError(result.error);
  if (result.data === null) throw new DataError('not_found', 'No data returned');
  return result.data;
}
