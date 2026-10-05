import styles from './wordmark.module.css';

/**
 * The wordmark: "curios" in Bricolage, with the dot of the i replaced by the
 * ask bar's own shape -- a small stamped field. Built from text, not drawn
 * coordinates, so the field sits on the i in whatever face actually loaded.
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={[styles.mark, className].filter(Boolean).join(' ')} aria-hidden="true">
      cur<span className={styles.i}>ı</span>os
    </span>
  );
}
