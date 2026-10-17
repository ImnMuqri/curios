import type { Metadata } from 'next';
import { NotFoundScreen } from './_system/NotFoundScreen.js';

export const metadata: Metadata = { title: 'Nobody lives here yet · Curios', robots: { index: false } };

/** Every address with nothing behind it, page handles included. */
export default function NotFound() {
  return <NotFoundScreen />;
}
