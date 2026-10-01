import styles from './AnswerBubble.module.css';

/**
 * The answer, as it arrives. Announced politely rather than assertively: an
 * assertive region interrupts a screen reader on every streamed token, which
 * turns a streaming answer into an unusable stutter.
 */
export function AnswerBubble({ text }: { text: string }) {
  return (
    <p role="status" aria-live="polite" className={styles.bubble}>
      {text}
    </p>
  );
}
