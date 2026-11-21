'use client';

import * as React from 'react';

/**
 * Android (and browser) back button support for overlays such as the menu sheet and dialogs.
 * While `open` is true, the overlay owns one history entry. Back closes the overlay instead of
 * leaving the page. Closing it from the UI removes that entry again so back still works normally.
 */
export function useBackLayer(open: boolean, close: () => void, id: string): void {
  const closeRef = React.useRef(close);
  React.useEffect(() => {
    closeRef.current = close;
  });

  React.useEffect(() => {
    if (!open) return;
    const previous = typeof window.history.state === 'object' && window.history.state !== null ? window.history.state : {};
    window.history.pushState({ ...previous, erpLayer: id }, '');
    let closedByBack = false;
    const onPop = () => {
      closedByBack = true;
      closeRef.current();
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      if (!closedByBack && window.history.state?.erpLayer === id) window.history.back();
    };
  }, [open, id]);
}
