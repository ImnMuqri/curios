'use client';

import { useEffect, useRef } from 'react';
import type { CoverTint } from '@curios/core/bento';
import styles from './Bento.module.css';

/**
 * The document itself in a colour: the root, the body, and the browser's bars (theme-color). A phone
 * shows the document wherever the page does not reach -- the strip behind the status bar, under the
 * keyboard, past either end of a scroll -- and left as the site's paper it is a white band over a dark
 * page. The body as well as the root because iOS 26 Safari colours its status bar's strip from the
 * body, which the base stylesheet gives the site's paper. `body: false` leaves the body its paper,
 * for a page that sits as a column on it on a wide screen. `foot` paints the root alone in another
 * colour (the body and the bars keep `color`): what shows past the foot of a page whose cover runs
 * another colour down there. Returns what puts everything back.
 */
export function paintDocument(color: string, { body = true, foot }: { body?: boolean; foot?: string } = {}): () => void {
  const root = document.documentElement;
  const before = { root: root.style.backgroundColor, body: document.body.style.backgroundColor };
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  const added = !meta;
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.append(meta);
  }
  const metaBefore = meta.content;
  root.style.backgroundColor = foot ?? color;
  if (body) document.body.style.backgroundColor = color;
  meta.content = color;
  return () => {
    root.style.backgroundColor = before.root;
    document.body.style.backgroundColor = before.body;
    if (added) meta.remove();
    else meta.content = metaBefore;
  };
}

/** `rgb(r, g, b)` from a computed colour and a six-digit hex, `share` of the first: as `color-mix(in srgb, …)` mixes, but written plainly for every browser's bars. */
export function mixRgb(rgb: string, hex: string, share: number): string | null {
  const a = rgb.match(/\d+(\.\d+)?/g)?.slice(0, 3).map(Number);
  const b = /^#[0-9a-f]{6}$/i.test(hex) ? [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) : null;
  if (!a || a.length < 3 || !b) return null;
  const [r, g, bl] = a.map((c, i) => Math.round(c * share + b[i]! * (1 - share)));
  return `rgb(${r}, ${g}, ${bl})`;
}

/**
 * Paints the document in the page's own colour (`--page-bg`, from the PageTheme it sits in), for the
 * public pages that wear a page's look: the shop, an item, checkout, an order, the FAQ. Read from a
 * probe that wears the colour, so whatever the theme resolves it to is what the document gets.
 *
 * With the cover's colours (`tint`), a phone's bars follow the blurred cover instead: its top colour
 * under the page's veil as the shop draws it there (35% of the page's colour), and its foot under the
 * deeper veil further down (62%), so neither strip is a plain band over the photo.
 */
export function DocumentColor({ tint }: { tint?: CoverTint | null }) {
  const probe = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!probe.current) return;
    const page = getComputedStyle(probe.current).backgroundColor;
    const top = tint ? mixRgb(page, tint.top, 0.35) : null;
    const foot = tint ? mixRgb(page, tint.bottom, 0.62) : null;
    return paintDocument(top ?? page, foot ? { foot } : {});
  }, [tint?.top, tint?.bottom]);
  return <span ref={probe} className={styles.documentProbe} aria-hidden="true" />;
}
