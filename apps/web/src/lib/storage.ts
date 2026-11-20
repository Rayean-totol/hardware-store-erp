/**
 * localStorage wrapper for per-device preferences (locale, selected org, device id).
 * Storage can be unavailable (private mode, blocked site data); preferences then simply
 * do not persist — that is not an error worth surfacing to the user.
 */
export function readPref(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writePref(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // ignore: preference persistence is best-effort
  }
}

/** Stable id for this installation, sent as x-device-id and stored in the audit log. */
export function getDeviceId(): string {
  const existing = readPref('erp.deviceId');
  if (existing) return existing;
  const id = crypto.randomUUID();
  writePref('erp.deviceId', id);
  return id;
}
