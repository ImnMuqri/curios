import type { Metadata, Viewport } from 'next';

/*
 * The dashboard installs to a home screen as an app (public/manifest.webmanifest,
 * which opens /app). Linked from the dashboard and the landing only: an owner's
 * own page at curios.my/{handle} carries no manifest, so a visitor who adds it to
 * their home screen gets a shortcut to that page, not Curios's dashboard.
 */
export const metadata: Metadata = {
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'Curios', statusBarStyle: 'default' },
};

export const viewport: Viewport = { themeColor: '#0593c6' };
