import type { ReactNode } from 'react';
import styles from './visitor-question.module.css';

/**
 * A visitor's question in an owner preview: the translucent bubble the public
 * chat draws, in the colours of whatever panel it sits on. Every preview that
 * shows a question uses this one.
 */
export function VisitorQuestion({ className, children }: { className?: string; children: ReactNode }) {
  return <span className={className ? `${styles.question} ${className}` : styles.question}>{children}</span>;
}
