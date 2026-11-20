import type { ReactNode } from 'react';
import { LivePeek } from '../../_peek/LivePeek.js';
import styles from './inbox.module.css';

/**
 * An inbox screen with nothing in it yet (Dash.html `.xempty`): Peek, watching the pointer, over a
 * title (an h2, under the page's h1), one line saying what will land here, and the buttons that bring it in. It takes the place
 * of the strip, the filters and the list; the header stays.
 *
 *   <EmptyPeek title="No orders yet" line="Share your shop and orders land here.">
 *     <a className={...} href="/app/store">Open your shop</a>
 *   </EmptyPeek>
 */
export function EmptyPeek({ title, line, children }: { title: string; line: ReactNode; children?: ReactNode }) {
  return (
    <div className={styles.emptyPeek}>
      <span className={styles.emptyPeekArt}>
        <LivePeek width={110} follow />
      </span>
      <h2 className={styles.emptyPeekTitle}>{title}</h2>
      <p className={styles.emptyPeekLine}>{line}</p>
      {children ? <div className={styles.emptyPeekActions}>{children}</div> : null}
    </div>
  );
}
