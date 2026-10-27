import styles from './Thinking.module.css';

/**
 * The wait before a reply: the wordmark's o, bobbing with its eyes looking
 * from side to side, and a word. Drawn wherever a page is about to answer --
 * the public chat and the owner's previews -- so the wait looks like curios
 * in all of them. The o is the wordmark's own ring and eyes; its colour is
 * --mo-ring, the page's accent where the caller sets one.
 */
export function Thinking({ label = 'Inquiring' }: { label?: string }) {
  return (
    <span className={styles.thinking}>
      <svg className={styles.mo} viewBox="0 0 40 40" aria-hidden="true">
        <circle className={styles.ring} cx="20" cy="20" r="15.6" />
        <g className={styles.eyes}>
          <circle cx="14.8" cy="16" r="4.1" />
          <circle cx="25.2" cy="16" r="4.1" />
        </g>
      </svg>
      {label}…
    </span>
  );
}
