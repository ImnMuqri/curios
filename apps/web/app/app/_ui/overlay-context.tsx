'use client';

import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * What the frame hands a SideSheet, a Dialog and the toast:
 * - `enter` tells the frame a modal layer is open (the phone's menu hides, and the rest of the frame
 *   goes inert); it returns the way to leave;
 * - `host` is the element the layers render into: the last child of `.frame`, inside it so the calm
 *   tokens and dark mode apply, and outside `main`, so no page's sticky or animated box can trap a
 *   fixed layer (a transformed or sticky ancestor does). Null until the frame has mounted.
 * The context itself is null outside the frame (a story, a bare page): layers then render in place.
 */
export const OverlayContext = createContext<{ enter: () => () => void; host: HTMLElement | null } | null>(null);

/** Register as an open overlay for as long as `open` is true. */
export function useOverlayOpen(open: boolean) {
  const frame = useContext(OverlayContext);
  useEffect(() => {
    if (!open || !frame) return;
    return frame.enter();
  }, [open, frame]);
}

/**
 * Render `children` in the frame's layer host; outside the frame, in place. Inside the frame but before
 * the host has mounted (the server render, the first paint) nothing: a closed layer is hidden anyway.
 */
export function LayerPortal({ children }: { children: ReactNode }) {
  const frame = useContext(OverlayContext);
  if (!frame) return <>{children}</>;
  return frame.host ? createPortal(children, frame.host) : null;
}

/** Whether the layers render in the frame's host (so the rest of the frame is made inert while one is open). */
export function useInFrame() {
  return useContext(OverlayContext) !== null;
}
