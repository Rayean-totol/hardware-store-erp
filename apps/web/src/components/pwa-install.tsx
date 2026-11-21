'use client';

import * as React from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

// Captured as early as possible: the browser fires beforeinstallprompt once, possibly before React mounts.
let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
let installedFlag = false;

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferred = event as BeforeInstallPromptEvent;
    listeners.forEach((l) => l());
  });
  window.addEventListener('appinstalled', () => {
    installedFlag = true;
    deferred = null;
    listeners.forEach((l) => l());
  });
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const byMedia = typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches;
  return byMedia || (navigator as { standalone?: boolean }).standalone === true;
}

/** Install support: Android and desktop Chromium use the browser prompt; iOS gets written steps instead. */
export function useInstallPrompt() {
  const [, bump] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    const listener = () => bump();
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  const installed = installedFlag || isStandalone();
  const ios = typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent);
  return {
    canInstall: deferred !== null && !installed,
    showIosHint: ios && !installed,
    installed,
    async install(): Promise<'accepted' | 'dismissed' | null> {
      if (!deferred) return null;
      const prompt = deferred;
      await prompt.prompt();
      const choice = await prompt.userChoice;
      deferred = null;
      listeners.forEach((l) => l());
      return choice.outcome;
    },
  };
}
