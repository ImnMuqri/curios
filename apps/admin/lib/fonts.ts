import localFont from 'next/font/local';

// The three faces the Admin board loads, committed as latin-subset woff2 under ./fonts so the build
// never asks Google for them (a bad answer from Google Fonts once failed the production build).
// Bricolage and IBM Plex Sans are variable files; their licences (SIL OFL 1.1) sit beside them.
const bricolage = localFont({
  src: [{ path: './fonts/BricolageGrotesque-var.woff2', weight: '700 800', style: 'normal' }],
  variable: '--font-bricolage',
  display: 'swap',
  fallback: ['system-ui', 'sans-serif'],
});
const plexSans = localFont({
  src: [{ path: './fonts/IBMPlexSans-var.woff2', weight: '400 600', style: 'normal' }],
  variable: '--font-plex-sans',
  display: 'swap',
  fallback: ['system-ui', 'sans-serif'],
});
const plexMono = localFont({
  src: [
    { path: './fonts/IBMPlexMono-400.woff2', weight: '400', style: 'normal' },
    { path: './fonts/IBMPlexMono-500.woff2', weight: '500', style: 'normal' },
  ],
  variable: '--font-plex-mono',
  display: 'swap',
  fallback: ['ui-monospace', 'monospace'],
});

export const fontVariables = [bricolage, plexSans, plexMono].map((f) => f.variable).join(' ');
