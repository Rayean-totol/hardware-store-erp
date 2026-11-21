/**
 * Connection model for the app. Pure functions only, so every transition can be unit-tested.
 *
 * Writes are allowed only when the server has been reached recently AND the browser reports a
 * connection. Until the first server check succeeds the app is "reconnecting" and writes stay off.
 */

export type ConnectionState = 'online' | 'offline' | 'reconnecting';

export interface ConnectionModel {
  /** navigator.onLine as last reported by the browser. */
  browserOnline: boolean;
  /** Result of the last server check since the last browser change. null = not checked yet. */
  serverReachable: boolean | null;
}

export type ConnectionEvent = { type: 'browser'; online: boolean } | { type: 'check'; reachable: boolean };

export const initialConnection: ConnectionModel = { browserOnline: true, serverReachable: null };

export function reduceConnection(model: ConnectionModel, event: ConnectionEvent): ConnectionModel {
  if (event.type === 'browser') {
    // A change of browser state invalidates the previous server result.
    if (event.online === model.browserOnline) return model;
    return { browserOnline: event.online, serverReachable: null };
  }
  return { ...model, serverReachable: event.reachable };
}

export function deriveConnection(model: ConnectionModel): ConnectionState {
  if (!model.browserOnline) return 'offline';
  if (model.serverReachable === true) return 'online';
  if (model.serverReachable === false) return 'offline';
  return 'reconnecting';
}

export const writesAllowed = (state: ConnectionState): boolean => state === 'online';

/** Health check against the Supabase auth service. Never throws: any failure is "not reachable". */
export async function checkServer(
  url: string,
  anonKey: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 5000,
): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${url.replace(/\/$/, '')}/auth/v1/health`, {
      method: 'GET',
      headers: { apikey: anonKey },
      cache: 'no-store',
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
