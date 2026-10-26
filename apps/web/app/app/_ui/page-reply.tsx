import type { ReactNode } from 'react';
import styles from './page-reply.module.css';

/**
 * The page's reply in an owner preview: plain text under a small
 * "{Name}’s page" label with the page's accent dot, never a bubble (the public page draws it the same
 * way). The words and the label take the colour of the panel they sit on, so
 * they read on a light page as well as a dark one. Given a `label`, it is the
 * wait before the reply: a status, so a screen reader says it.
 */
export function PageReply({
  name,
  className,
  children,
  label,
}: {
  name?: string;
  className?: string;
  children: ReactNode;
  label?: string;
}) {
  return (
    <span className={className ? `${styles.reply} ${className}` : styles.reply} {...(label ? { role: 'status', 'aria-label': label } : {})}>
      <span className={styles.who}>
        <i className={styles.dot} aria-hidden="true" />
        <span className={styles.whoName}>{name ? `${name}’s page` : 'Your page'}</span>
      </span>
      <span className={styles.words}>{children}</span>
    </span>
  );
}
