import styles from './curios.module.css';

const ICONS = {
  image: 'M4 5h16v14H4zM4 15l4-4 4 4 3-3 5 5M9 9h.01',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM5 20a7 7 0 0 1 14 0',
  at: 'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM16 12v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-3.5 7.1',
  link: 'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7',
  style: 'M4 7h16M4 12h16M4 17h10',
  layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
  palette: 'M12 3a9 9 0 1 0 0 18c1.1 0 1.8-.8 1.8-1.7 0-1 .8-1.8 1.8-1.8H17a4 4 0 0 0 4-4C21 7 17 3 12 3zM7.5 11h.01M10.5 7h.01M15 7.5h.01',
  type: 'M5 6V4h14v2M12 4v16M9 20h6',
} as const;

/**
 * A section's heading: a tinted icon chip and the title on the left, a short
 * note on the right (under the title on a phone). The chip's tone only tells
 * sections apart; it never means a state.
 */
export function SectionHead({
  id,
  icon,
  tone,
  title,
  note,
}: {
  id: string;
  icon: keyof typeof ICONS;
  tone: 'biru' | 'hijau' | 'rose' | 'amber';
  title: string;
  note: string;
}) {
  return (
    <div className={styles.sectionHead}>
      <h2 id={id} className={styles.sectionTitle}>
        <span className={styles.chip} data-tone={tone} aria-hidden="true">
          <svg viewBox="0 0 24 24" width="15" height="15">
            <path d={ICONS[icon]} />
          </svg>
        </span>
        {title}
      </h2>
      <p className={styles.sectionNote}>{note}</p>
    </div>
  );
}
