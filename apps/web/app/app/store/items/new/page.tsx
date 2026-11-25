import type { Metadata } from 'next';
import { renderStore } from '../../store-page.js';

/** The tab's name: "Curios - New item" (the dashboard layout's template). */
export const metadata: Metadata = { title: 'New item' };

/** A new item, on its own screen: the first save gives it an id and the address follows. */
export default async function NewItemPage() {
  return renderStore({ editing: 'new' });
}
