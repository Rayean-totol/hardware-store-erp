import { DataError } from '@erp/data';

/** Repository methods that change data. Every other method is a read and is left alone. */
export const WRITE_METHOD = /^(save|create|update|delete|set|submit|approve|cancel|finalize|adjust|apply|add|upload|import|archive|receive|void|post|remove|discard)/;

export const OFFLINE_WRITE_CODE = 'offline.writes_disabled';

/**
 * Wraps every write method of the given repositories so that it refuses to run unless `isOpen()`
 * is true. The refusal is a typed error, so the UI shows a clear message and nothing is sent.
 */
export function guardWrites<T extends Record<string, unknown>>(repos: T, isOpen: () => boolean): T {
  const guarded: Record<string, unknown> = {};
  for (const [repoName, repo] of Object.entries(repos)) {
    if (!repo || typeof repo !== 'object') {
      guarded[repoName] = repo;
      continue;
    }
    const methods: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(repo as Record<string, unknown>)) {
      if (typeof value === 'function' && WRITE_METHOD.test(name)) {
        methods[name] = (...args: unknown[]) => {
          if (!isOpen()) {
            return Promise.reject(new DataError(OFFLINE_WRITE_CODE, 'Writes are disabled while the device is offline.'));
          }
          return (value as (...a: unknown[]) => unknown)(...args);
        };
      } else {
        methods[name] = value;
      }
    }
    guarded[repoName] = methods;
  }
  return guarded as T;
}
