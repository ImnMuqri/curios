import type { ReactNode } from 'react';
import styles from './empty-state.module.css';

/** One stroke icon per kind of empty list, drawn like the sidebar's. */
const ICONS = {
  facts: <><path d="M4 19.5V5a2 2 0 0 1 2-2h14v16H6a2 2 0 0 0-2 2z" /><path d="M8 7h8M8 11h6" /></>,
  sources: <><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></>,
  pinned: <><path d="M12 17v5" /><path d="M9 3h6l-1 6 4 4H6l4-4z" /></>,
  never: <><circle cx="12" cy="12" r="9" /><path d="M5.6 5.6l12.8 12.8" /></>,
  questions: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
  leads: <><circle cx="9" cy="7" r="4" /><path d="M2 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2" /></>,
  done: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  links: <><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /></>,
} as const;

/**
 * What an empty list says instead of nothing: what will be here, and the one
 * thing to do about it. DESIGN.md: "Empty states are invitations." An
 * instruction, never a mood -- and the action, when there is an obvious one,
 * is right here rather than somewhere else on the screen.
 */
export function EmptyState({
  icon,
  title,
  children,
  action,
  compact = false,
}: {
  icon: keyof typeof ICONS;
  title: string;
  children?: ReactNode;
  /** A Button or a link: the next step, if there is one. */
  action?: ReactNode;
  /** Inside a card that already frames it (My Curios' links): no card of its own. */
  compact?: boolean;
}) {
  return (
    <div className={styles.empty} data-compact={compact || undefined}>
      <span className={styles.icon} aria-hidden="true">
        <svg viewBox="0 0 24 24" width="22" height="22">
          {ICONS[icon]}
        </svg>
      </span>
      <p className={styles.title}>{title}</p>
      {children ? <p className={styles.text}>{children}</p> : null}
      {action ? <div className={styles.action}>{action}</div> : null}
    </div>
  );
}
