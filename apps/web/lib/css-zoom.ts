/**
 * How much CSS `zoom` scales an element: 0.9 on a laptop (globals.css), 1 elsewhere.
 *
 * Under zoom, getBoundingClientRect and pointer coordinates are in the window's
 * pixels, while a length written back into a style is in the element's own CSS
 * pixels, which the zoom then shrinks again. Code that measures a box and sets
 * a width, a path or a drag distance from it divides by this first.
 *
 * `currentCSSZoom` ships with standard zoom (Chrome 128, Firefox 126). Where it
 * is missing the answer is 1, which leaves the measurement as it always was.
 */
export function cssZoom(el: Element | null | undefined): number {
  // Typed as always there, but older browsers return undefined: hence the typeof.
  const zoom: unknown = el?.currentCSSZoom;
  return typeof zoom === 'number' && zoom > 0 ? zoom : 1;
}
