'use client';

import { useEffect, useRef } from 'react';
import styles from './Bento.module.css';

/**
 * The document itself in a colour: the root, the body, and the browser's bars (theme-color). A phone
 * shows the document wherever the page does not reach -- the strip behind the status bar, under the
 * keyboard, past either end of a scroll -- and left as the site's paper it is a white band over a dark
 * page. The body as well as the root because iOS 26 Safari colours its status bar's strip from the
 * body, which the base stylesheet gives the site's paper. `body: false` leaves the body its paper,
 * for a page that sits as a column on it on a wide screen. Returns what puts everything back.
 */
export function paintDocument(color: string, { body = true }: { body?: boolean } = {}): () => void {
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
  root.style.backgroundColor = color;
  if (body) document.body.style.backgroundColor = color;
  meta.content = color;
  return () => {
    root.style.backgroundColor = before.root;
    document.body.style.backgroundColor = before.body;
    if (added) meta.remove();
    else meta.content = metaBefore;
  };
}

/**
 * Paints the document in the page's own colour (`--page-bg`, from the PageTheme it sits in), for the
 * public pages that wear a page's look: the shop, an item, checkout, an order, the FAQ. Read from a
 * probe that wears the colour, so whatever the theme resolves it to is what the document gets.
 */
export function DocumentColor() {
  const probe = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!probe.current) return;
    return paintDocument(getComputedStyle(probe.current).backgroundColor);
  }, []);
  return <span ref={probe} className={styles.documentProbe} aria-hidden="true" />;
}
