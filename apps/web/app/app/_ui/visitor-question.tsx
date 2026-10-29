import type { ReactNode } from 'react';
import styles from './visitor-question.module.css';

/**
 * A visitor's question in an owner preview. Inside the dashboard (Dashboard v2) it is a card
 * bubble with a hairline, as an AI chat draws the person's message; in a preview of the owner's
 * real page (`onPage`, the phone in My Curios) it is the translucent bubble the public chat
 * draws, in the colours of whatever panel it sits on.
 */
export function VisitorQuestion({ className, children, onPage = false }: { className?: string; children: ReactNode; onPage?: boolean }) {
  return (
    <span className={className ? `${styles.question} ${className}` : styles.question} data-on-page={onPage || undefined}>
      {children}
    </span>
  );
}
