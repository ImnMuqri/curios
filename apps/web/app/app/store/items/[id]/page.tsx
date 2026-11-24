import { renderStore } from '../../store-page.js';

/** One item, on its own screen. */
export default async function ItemPage({ params }: { params: Promise<{ id: string }> }) {
  return renderStore({ editing: (await params).id });
}
