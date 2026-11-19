'use client';

import { createContext, useContext, useEffect } from 'react';

/**
 * How a SideSheet or Dialog tells the frame it is open (the frame hides the phone's menu while one
 * is). `enter` returns the way to leave. Null outside the frame (a story, a bare page): nothing to tell.
 */
export const OverlayContext = createContext<{ enter: () => () => void } | null>(null);

/** Register as an open overlay for as long as `open` is true. */
export function useOverlayOpen(open: boolean) {
  const frame = useContext(OverlayContext);
  useEffect(() => {
    if (!open || !frame) return;
    return frame.enter();
  }, [open, frame]);
}
