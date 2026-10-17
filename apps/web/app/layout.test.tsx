import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
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
    // IBM Plex Sans is every screen's reading face (the design handoff), so the root binds it once.
    expect(html).toContain('font-plex-sans');
  });
});
