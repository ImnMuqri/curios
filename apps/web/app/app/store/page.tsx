import { renderStore } from './store-page.js';

export default async function StorePage({ searchParams }: { searchParams: Promise<{ tab?: string | string[] }> }) {
  return renderStore({ tab: (await searchParams).tab, editing: null });
}
