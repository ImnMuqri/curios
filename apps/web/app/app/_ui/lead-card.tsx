import styles from './lead-card.module.css';

/** The first word of a name: "Kek Lina" is "Kek", as the page's own copy takes it. */
export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/**
 * The card the chat offers when it cannot answer: "{First name} can answer
 * this one", one number field and Send. In an owner preview it is a picture
 * of the visitor's card, so nothing in it sends.
 */
export function LeadCard({ name, className }: { name: string; className?: string }) {
  const first = firstName(name);
  return (
    <span className={className ? `${styles.card} ${className}` : styles.card}>
      <b>{first} can answer this one</b>
      <small>Leave your WhatsApp number and {first} will get back to you, usually the same day.</small>
      <span className={styles.row}>
        <input className={styles.field} type="tel" readOnly tabIndex={-1} placeholder="012-345 6789" aria-label="Your WhatsApp number" />
        <button className={styles.send} type="button" tabIndex={-1} aria-disabled="true">
          Send
        </button>
      </span>
    </span>
  );
}
