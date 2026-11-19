import { render } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import RootLayout from './layout.js';

describe('RootLayout', () => {
  it('binds all three font variables on the html element', () => {
    // tokens.css reads --font-bricolage, --font-inter and --font-plex-mono. If
    // the layout stops binding one, every heading silently falls back to
    // system-ui -- the page still renders, every other test still passes, and
    // nobody finds out until someone looks at it on a phone.
    render(<RootLayout>{null}</RootLayout>);

    // document.documentElement, not the render container. React 19 hoists
    // <html> and <body> out of wherever they were rendered and applies their
    // attributes to the real document, so the container ends up empty and
    // querySelector('html') finds nothing -- which looks exactly like a layout
    // that forgot the fonts.
    const html = document.documentElement.className;

    expect(html).toContain('font-bricolage');
    expect(html).toContain('font-inter');
    expect(html).toContain('font-plex-mono');
    // IBM Plex Sans still reads the landing and the legal pages (the app and auth moved to Inter), so the root binds it once.
    expect(html).toContain('font-plex-sans');
  });

  it('marks <html> with `js` from an inline script in <head>, before anything paints', () => {
    // The landing's scroll reveal hides a block only under `.js`: a page whose scripts never ran shows everything.
    const html = renderToString(<RootLayout>{null}</RootLayout>);
    const head = html.match(/<head>([\s\S]*?)<\/head>/)?.[1] ?? '';
    expect(head).toContain("<script>document.documentElement.classList.add('js')</script>");
    expect(html.indexOf('<script>')).toBeLessThan(html.indexOf('<body'));
    // The class lands before hydration; <html> must not report it as a mismatch.
    document.documentElement.className = 'js';
    const errors: unknown[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...a) => void errors.push(a));
    render(<RootLayout>{null}</RootLayout>);
    spy.mockRestore();
    expect(errors).toEqual([]);
  });
});
