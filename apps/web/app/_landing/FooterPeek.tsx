import { useId } from 'react';
import styles from './tanya.module.css';

/**
 * Full-body Peek standing on the o of the footer's giant wordmark. The board's
 * markup (TanyaJe.dc.html), sized in em so it scales with the wordmark. Curios's
 * own page only; decorative.
 */
export function FooterPeek() {
  // The landing already has other Peeks; the clip id stays unique.
  const clipId = `pkf-clip-${useId().replace(/:/g, '')}`;
  return (
    <span className={styles.footPeek} aria-hidden="true">
      <svg viewBox="0 0 160 150">
        <defs>
          <clipPath id={clipId}>
            <ellipse cx="80" cy="84" rx="54" ry="49" />
          </clipPath>
        </defs>
        <ellipse cx="80" cy="143" rx="40" ry="4" fill="var(--peek-ground-shadow)" />
        <g className={styles.pkfFootL}>
          <ellipse cx="63" cy="132" rx="13" ry="8" fill="var(--peek-foot)" />
        </g>
        <g className={styles.pkfFootR}>
          <ellipse cx="97" cy="132" rx="13" ry="8" fill="var(--peek-foot)" />
        </g>
        <g className={styles.pkfHandL}>
          <circle cx="19" cy="100" r="10" fill="var(--peek-body)" />
        </g>
        <g className={styles.pkfArmR}>
          <circle cx="139" cy="60" r="10" fill="var(--peek-body)" />
        </g>
        <g clipPath={`url(#${clipId})`}>
          <rect x="20" y="30" width="120" height="110" fill="var(--peek-shade)" />
          <ellipse cx="73" cy="76" rx="54" ry="48" fill="var(--peek-body)" />
        </g>
        <ellipse cx="55" cy="54" rx="9" ry="5" fill="var(--peek-shine)" transform="rotate(-30 55 54)" />
        <g className={styles.pkfEyes}>
          <ellipse cx="66" cy="82" rx="11.5" ry="13.5" fill="#fff" />
          <ellipse cx="95" cy="82" rx="11.5" ry="13.5" fill="#fff" />
          <g className={styles.pkfPupils}>
            <circle cx="67" cy="85" r="6.6" fill="var(--ink)" />
            <circle cx="96" cy="85" r="6.6" fill="var(--ink)" />
            <circle cx="69.2" cy="82" r="2.1" fill="#fff" />
            <circle cx="98.2" cy="82" r="2.1" fill="#fff" />
          </g>
        </g>
        <path d="M75 102q5.5 4.5 11 0" fill="none" stroke="var(--ink)" strokeWidth="3" strokeLinecap="round" />
      </svg>
    </span>
  );
}
