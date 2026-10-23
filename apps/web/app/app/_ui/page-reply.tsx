import type { ReactNode } from 'react';
import styles from './page-reply.module.css';

/**
 * The page's reply in an owner preview: plain text under a small
 * "{Name}’s page" label, never a bubble (the public page draws it the same
 * way). The words and the label take the colour of the panel they sit on, so
 * they read on a light page as well as a dark one.
 */
export function PageReply({
  name,
  className,
  children,
  ...aria
}: {
  name?: string;
  className?: string;
  children: ReactNode;
  'aria-label'?: string;
}) {
  return (
    <span className={className ? `${styles.reply} ${className}` : styles.reply} {...aria}>
      <span className={styles.who}>{name ? `${name}’s page` : 'Your page'}</span>
      <span className={styles.words}>{children}</span>
    </span>
  );
}
