import { guardWrites } from './write-guard';
import { connectionGate } from './connection-gate';
import type { Services } from './services';

/** Every repository in the app goes through this: writes are refused while the write gate is closed. */
export function guardServices(services: Services): Services {
  const { auth, ...repos } = services;
  return { auth, ...guardWrites(repos, () => connectionGate.isOpen()) } as Services;
}
