import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import '@curios/ui/tokens.css';
import '@curios/ui/reset.css';
import './globals.css';
import { Providers } from './providers.js';
import { fontVariables } from '../lib/fonts.js';
import { lookUpApi } from '../lib/api-hints.js';

/**
 * For any screen that names none of its own; without it such a screen had no <title> at all.
 * No default description: an owner's page would inherit Curios's.
 */
export const metadata: Metadata = { title: 'Curios' };

/*
 * Self-hosted at build time by next/font, deliberately. A shop's visitor is on
 * 4G in Malaysia; a runtime request to Google's CDN costs a connection they
 * cannot spare and a layout shift they will see.
 *
 * The variable names below are the seam. packages/ui reads --font-display and
 * friends, which resolve through these -- so the design system never imports
 * Next and stays renderable in a plain vitest jsdom.
 */
/*
 * Marks a page whose scripts run, before anything paints. Styles that hide a block until a script
 * reveals it (the landing's scroll reveal) are gated on `.js`, so a page whose scripts never ran
 * shows everything. Here, not in the landing's layout, because only the root layout owns <head>;
 * the class is harmless elsewhere (nothing else reads it). The class is added before hydration,
 * so <html> suppresses the attribute mismatch it would otherwise report.
 */
const JS_CLASS_SCRIPT = "document.documentElement.classList.add('js')";

/*
 * Chrome and Edge fire beforeinstallprompt as soon as the page qualifies, often before React has
 * hydrated the dashboard. This keeps the event (and notes an install) for the dashboard's
 * "Put Curios on your phone" card to read on mount (app/app/_ui/install-prompt.tsx).
 */
const INSTALL_SCRIPT =
  "addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__curiosInstall=e});addEventListener('appinstalled',function(){window.__curiosInstalled=true;window.__curiosInstall=null})";

export default function RootLayout({ children }: { children: ReactNode }) {
  lookUpApi();
  return (
    <html lang="en" className={fontVariables} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: JS_CLASS_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: INSTALL_SCRIPT }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
