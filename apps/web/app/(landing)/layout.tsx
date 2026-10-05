import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { SITE_URL } from '../_landing/structured-data.js';
import { plexSans } from '../_landing/plex.js';

/*
 * Here and not on the pages: Next resolves file-based metadata (the
 * opengraph-image next to each page) against the nearest LAYOUT's
 * metadataBase. Set only on the page, the share image pointed at
 * http://localhost:3000 -- in production too.
 */
export const metadata: Metadata = { metadataBase: new URL(SITE_URL) };

export default function LandingLayout({ children }: { children: ReactNode }) {
  return <div className={plexSans.variable}>{children}</div>;
}
