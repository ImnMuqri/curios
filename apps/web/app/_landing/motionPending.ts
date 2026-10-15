/**
 * The pre-paint half of the scroll scenes. The server draws every scene
 * finished and at natural height; the libraries that pin them arrive later, so
 * without this the pinned scenes would flip to 400vh/500vh after hydration and
 * push the page (and any #pricing deep link) out from under the reader.
 *
 * `pendMotion` runs as an inline script at the top of the landing root, before
 * the scenes paint. When motion is allowed it sets `data-motion-pending` on the
 * root, and the scenes' CSS lays out their pinned selves already. If motion
 * never turns on (the chunk failed), after `ms` it takes the attribute off and
 * the finished natural layout returns.
 *
 * It is serialised with toString(), so it must stay self-contained: no imports,
 * no closure over module state, nothing that needs gsap or lenis.
 */
export function pendMotion(win: { matchMedia?: (query: string) => { matches: boolean } }, root: Element, ms: number): boolean {
  try {
    const reduced = win.matchMedia ? win.matchMedia('(prefers-reduced-motion: reduce)') : null;
    if (reduced && reduced.matches) return false;
    root.setAttribute('data-motion-pending', '');
    setTimeout(function () {
      if (!root.querySelector('[data-motion="on"]')) root.removeAttribute('data-motion-pending');
    }, ms);
    return true;
  } catch (error) {
    return false;
  }
}

/** How long the pending layout waits for the libraries before giving up. */
export const MOTION_PENDING_MS = 4000;

/** The inline script's source: runs `pendMotion` on the root it sits in. */
export function motionPendingScript(): string {
  return `(${pendMotion.toString()})(window,document.currentScript.parentElement,${MOTION_PENDING_MS})`;
}
