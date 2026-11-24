import { renderStore } from '../../store-page.js';

/** A new item, on its own screen: the first save gives it an id and the address follows. */
export default async function NewItemPage() {
  return renderStore({ editing: 'new' });
}
