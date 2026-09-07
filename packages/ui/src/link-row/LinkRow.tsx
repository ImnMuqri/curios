import styles from './LinkRow.module.css';

/** Boring on purpose. 44px minimum target, label left, arrow right. */
export function LinkRow({ href, label }: { href: string; label: string }) {
  return (
    <a className={styles.row} href={href}>
      <span>{label}</span>
      <span className={styles.arrow} aria-hidden="true">
        →
      </span>
    </a>
  );
}
