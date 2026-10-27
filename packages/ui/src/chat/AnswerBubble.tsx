import type { ReactNode } from 'react';
import styles from './AnswerBubble.module.css';

/**
 * The answer, as it arrives. Announced politely rather than assertively: an
 * assertive region interrupts a screen reader on every streamed token, which
 * turns a streaming answer into an unusable stutter. `waiting` stands in
 * until the first word arrives, inside the same region, so it is announced
 * too.
 */
export function AnswerBubble({ text, waiting }: { text: string; waiting?: ReactNode }) {
  return (
    <p role="status" aria-live="polite" className={styles.bubble}>
      {text || waiting}
    </p>
  );
}
