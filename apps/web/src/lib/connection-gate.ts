/**
 * Process-wide write gate. The connection provider keeps it up to date; the guarded services
 * read it at call time. It starts closed: nothing can be written until the server is confirmed.
 */
let open = false;
const listeners = new Set<(open: boolean) => void>();

export const connectionGate = {
  isOpen(): boolean {
    return open;
  },
  set(next: boolean): void {
    if (next === open) return;
    open = next;
    for (const listener of listeners) listener(open);
  },
  subscribe(listener: (open: boolean) => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
