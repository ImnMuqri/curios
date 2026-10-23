import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import './globals.css';
import { fontVariables } from '../lib/fonts.js';

export const metadata: Metadata = { title: 'Curios admin', robots: { index: false, follow: false } };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={fontVariables}>
      <body>{children}</body>
    </html>
  );
}
