import type { ReactNode } from 'react';
import '@curios/ui/tokens.css';
import '@curios/ui/reset.css';
import './globals.css';
import { Providers } from './providers.js';
import { fontVariables } from '../lib/fonts.js';

/*
 * Self-hosted at build time by next/font, deliberately. A shop's visitor is on
 * 4G in Malaysia; a runtime request to Google's CDN costs a connection they
 * cannot spare and a layout shift they will see.
 *
 * The variable names below are the seam. packages/ui reads --font-display and
 * friends, which resolve through these -- so the design system never imports
 * Next and stays renderable in a plain vitest jsdom.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={fontVariables}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
