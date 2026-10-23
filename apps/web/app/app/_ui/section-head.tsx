import styles from './editor.module.css';

/**
 * A section's heading: the title on the left, text only, and a short note on
 * the right (under the title on a phone).
 */
export function SectionHead({
  id,
  title,
  note,
}: {
  id: string;
  title: string;
  note: string;
}) {
  return (
    <div className={styles.sectionHead}>
      <h2 id={id} className={styles.sectionTitle}>
        {title}
      </h2>
      <p className={styles.sectionNote}>{note}</p>
    </div>
  );
}
