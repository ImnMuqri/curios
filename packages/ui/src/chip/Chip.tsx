import type { ReactNode } from 'react';
import styles from './Chip.module.css';

/**
 * A generated question. The `lead` variant uses mint and there is at most one
 * per page -- DESIGN.md is explicit about that, and a second one stops the
 * first from reading as emphasis at all.
 */
export function Chip({
  children,
  variant = 'default',
}: {
  children: ReactNode;
  variant?: 'default' | 'lead';
}) {
  return (
    <span className={variant === 'lead' ? `${styles.chip} ${styles.lead}` : styles.chip}>
      {children}
    </span>
  );
}
