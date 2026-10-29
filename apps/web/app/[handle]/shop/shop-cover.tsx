import styles from './shop-page.module.css';

/**
 * The page's cover photo as the shop's backdrop (HANDOFF "Shop cover"; owner, 29 Oct 2026): blurred so
 * it reads as colour rather than a picture, under a tint of the page's colour, behind the whole of the
 * shop, an item and checkout alike. It fills its nearest positioned parent, which isolates it so it
 * stays behind that parent's content. `under` runs it on under a column's foot (the basket bar's room).
 */
export function ShopCover({ url, under = false }: { url: string | null | undefined; under?: boolean }) {
  if (!url) return null;
  return (
    <div className={under ? `${styles.cover} ${styles.coverUnder}` : styles.cover} aria-hidden="true">
      <img src={url} alt="" />
    </div>
  );
}
