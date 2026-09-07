import type { ReactNode } from 'react';
import { Bricolage_Grotesque, IBM_Plex_Mono, Inter } from 'next/font/google';
import '@curios/ui/tokens.css';
import '@curios/ui/reset.css';
import './globals.css';
import { Providers } from './providers.js';

/*
 * Self-hosted at build time by next/font, deliberately. A shop's visitor is on
 * 4G in Malaysia; a runtime request to Google's CDN costs a connection they
 * cannot spare and a layout shift they will see.
 *
 * The variable names below are the seam. packages/ui reads --font-display and
 * friends, which resolve through these -- so the design system never imports
 * Next and stays renderable in a plain vitest jsdom.
 */
const display = Bricolage_Grotesque({
  subsets: ['latin'],
  variable: '--font-bricolage',
  display: 'swap',
});
const body = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-plex-mono',
  display: 'swap',
});

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
