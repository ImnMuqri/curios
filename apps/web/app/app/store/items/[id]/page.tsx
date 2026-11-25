import type { Metadata } from 'next';
import { renderStore } from '../../store-page.js';

/** The tab's name: "Curios - Edit item" (the dashboard layout's template). */
export const metadata: Metadata = { title: 'Edit item' };

/** One item, on its own screen. */
export default async function ItemPage({ params }: { params: Promise<{ id: string }> }) {
  return renderStore({ editing: (await params).id });
}
