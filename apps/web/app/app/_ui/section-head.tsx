import styles from './editor.module.css';

/**
 * A section's heading: the title, text only, with a short note under it
 * (Dashboard v3: no longer across from it).
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
