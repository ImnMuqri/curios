import type { ReactNode } from 'react';
import styles from './top-bar.module.css';

const ICON = {
  back: 'M15 6l-6 6 6 6',
  basket: 'M5 8h14l-1.4 11.2a1 1 0 0 1-1 .8H7.4a1 1 0 0 1-1-.8zM9 8V6a3 3 0 0 1 6 0v2',
  share: 'M12 15V3M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6',
};

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

type Click = (event: { preventDefault: () => void }) => void;

/**
 * The owner-themed bar over a customer sub-page's light sheet (More board, `.cu-top`): back, the page's
 * name, then optionally a basket with its count and a share button. Wears the page's own colours
 * (--page-bg / --page-fg from PageTheme); the sheet below it is Curios'. Server-safe: handlers come in as props.
 */
export function TopBar(props: {
  title: ReactNode;
  back: { href?: string; label: string; onClick?: Click };
  /** A link when `href` is given (the product page: on to checkout), a button otherwise (the shop: opens the basket). */
  basket?: { label: string; count: number; href?: string; onClick?: Click };
  share?: { label: string; onClick: () => void };
}) {
  const { basket, share } = props;
  return (
    <div className={styles.top}>
      <a className={styles.ib} href={props.back.href} aria-label={props.back.label} onClick={props.back.onClick}>
        <Icon d={ICON.back} />
      </a>
      <div className={styles.title}>{props.title}</div>
      {basket ? (
        basket.href ? (
          <a className={`${styles.ib} ${styles.bk}`} href={basket.href} aria-label={basket.label} onClick={basket.onClick}>
            <Icon d={ICON.basket} />
            {basket.count > 0 ? <i>{basket.count}</i> : null}
          </a>
        ) : (
          <button type="button" className={`${styles.ib} ${styles.bk}`} aria-label={basket.label} onClick={basket.onClick}>
            <Icon d={ICON.basket} />
            {basket.count > 0 ? <i>{basket.count}</i> : null}
          </button>
        )
      ) : null}
      {share ? (
        <button type="button" className={styles.ib} aria-label={share.label} onClick={share.onClick}>
          <Icon d={ICON.share} />
        </button>
      ) : null}
      {!basket && !share ? <span className={styles.ib} aria-hidden="true" style={{ visibility: 'hidden' }} /> : null}
    </div>
  );
}
