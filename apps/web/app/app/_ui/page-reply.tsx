import type { ReactNode } from 'react';
import styles from './page-reply.module.css';

/**
 * The page's reply in an owner preview: plain text, never a bubble, under a small
 * "{Name}’s page" label. Given a `label`, it is the wait before the reply: a status, so a screen
 * reader says it.
 *
 * Inside the dashboard (Questions, Leads, Review, Ask your page) it reads like any AI chat
 * (Dashboard v2): ink words on the frame's neutral chat panel, the label beside Peek's eyes. In
 * a preview of the owner's real page (`onPage`, the phone in My Curios) it keeps the page's own
 * look, as the public chat draws it: the panel's colours and the page's accent dot.
 */
export function PageReply({
  name,
  className,
  children,
  label,
  onPage = false,
}: {
  name?: string;
  className?: string;
  children: ReactNode;
  label?: string;
  onPage?: boolean;
}) {
  return (
    <span
      className={className ? `${styles.reply} ${className}` : styles.reply}
      data-on-page={onPage || undefined}
      {...(label ? { role: 'status', 'aria-label': label } : {})}
    >
      <span className={styles.who}>
        {onPage ? (
          <i className={styles.dot} aria-hidden="true" />
        ) : (
          <svg className={styles.peek} viewBox="0 0 16 16" aria-hidden="true">
            <rect width="16" height="16" rx="5" className={styles.peekFace} />
            <ellipse cx="5.4" cy="8" rx="2.2" ry="2.6" className={styles.peekWhite} />
            <ellipse cx="10.6" cy="8" rx="2.2" ry="2.6" className={styles.peekWhite} />
            <circle cx="5.9" cy="8.6" r="1.1" className={styles.peekPupil} />
            <circle cx="11.1" cy="8.6" r="1.1" className={styles.peekPupil} />
          </svg>
        )}
        <span className={styles.whoName}>{name ? `${name}’s page` : 'Your page'}</span>
      </span>
      <span className={styles.words}>{children}</span>
    </span>
  );
}
