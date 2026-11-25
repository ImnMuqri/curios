import type { Metadata } from 'next';
import { renderStore } from './store-page.js';

/** The tab's name: "Curios - Store" (the dashboard layout's template). */
export const metadata: Metadata = { title: 'Store' };

export default async function StorePage({ searchParams }: { searchParams: Promise<{ tab?: string | string[] }> }) {
  return renderStore({ tab: (await searchParams).tab, editing: null });
}
