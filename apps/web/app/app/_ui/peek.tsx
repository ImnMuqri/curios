import styles from './peek.module.css';

/** Peek's body, the same in every pose; the eyes look to (look.x, look.y) and the mouth is the pose's. */
export function PeekBody({ clipId, look, mouth }: { clipId: string; look?: { x: number; y: number }; mouth?: 'smile' | 'flat' | 'happy' | 'frown' }) {
  return (
    <g className={styles.bob}>
      <g clipPath={`url(#${clipId})`}>
        <rect x="20" y="30" width="120" height="110" fill="var(--peek-shade)" />
        <ellipse cx="73" cy="76" rx="54" ry="48" fill="var(--peek-body)" />
      </g>
      <ellipse cx="55" cy="54" rx="9" ry="5" fill="var(--peek-shine)" transform="rotate(-30 55 54)" />
      {mouth === 'happy' ? (
        <path d="M55 86q11-13 22 0M84 86q11-13 22 0" fill="none" stroke="var(--card)" strokeWidth="5.5" strokeLinecap="round" />
      ) : look ? (
        <g className={styles.eyes}>
          <ellipse cx="66" cy="82" rx="11.5" ry="13.5" fill="var(--card)" />
          <ellipse cx="95" cy="82" rx="11.5" ry="13.5" fill="var(--card)" />
          <circle cx={look.x} cy={look.y} r="6.6" fill="var(--ink)" />
          <circle cx={look.x + 29} cy={look.y} r="6.6" fill="var(--ink)" />
          <circle cx={look.x + 2.2} cy={look.y - 3} r="2.1" fill="var(--card)" />
          <circle cx={look.x + 31.2} cy={look.y - 3} r="2.1" fill="var(--card)" />
        </g>
      ) : null}
      {mouth === 'smile' ? <path d="M75 104q5.5 4.5 11 0" fill="none" stroke="var(--ink)" strokeWidth="3" strokeLinecap="round" /> : null}
      {mouth === 'frown' ? <path d="M75 106q5.5-4.5 11 0" fill="none" stroke="var(--ink)" strokeWidth="3" strokeLinecap="round" /> : null}
      {mouth === 'flat' ? <path d="M76 105h9" fill="none" stroke="var(--ink)" strokeWidth="3" strokeLinecap="round" /> : null}
      {mouth === 'happy' ? <path d="M72 102q8.5 9 17 0z" fill="var(--ink)" stroke="var(--ink)" strokeWidth="2" strokeLinejoin="round" /> : null}
    </g>
  );
}
