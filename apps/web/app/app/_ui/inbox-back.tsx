import styles from './inbox.module.css';

/**
 * "‹ All orders": the way back from a picked item's own view on a phone (Dash.html .xdback). It
 * shows only under 1100px and only inside a `.split[data-open]`; put it first in the `.det` card.
 * `onBack` is the page's: it drops `data-open` (and the `?order=` in the address, if it keeps one).
 */
export function InboxBack({ noun, onBack }: { noun: string; onBack: () => void }) {
  return (
    <button type="button" className={styles.back} onClick={onBack}>
      <span aria-hidden="true">‹</span>All {noun}
    </button>
  );
}
