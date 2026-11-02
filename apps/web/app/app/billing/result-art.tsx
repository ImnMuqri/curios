import Link from 'next/link';
import { Wordmark } from '../../_landing/Wordmark.js';
import { PeekBody } from '../_ui/peek.js';
import styles from './result.module.css';

/** Confetti for the paid page: where each piece falls from, its colour and its pace. From the Billing board. */
const CONFETTI: [left: number, color: string, delay: number, seconds: number][] = [
  [6, 'var(--light-biru)', -0.2, 2.9],
  [14, 'var(--confetti-gold)', -1.4, 3.3],
  [22, 'var(--confetti-red)', -0.7, 2.7],
  [31, 'var(--confetti-green)', -2.1, 3.6],
  [39, 'var(--confetti-lilac)', -0.4, 3.1],
  [47, 'var(--light-biru)', -1.8, 2.8],
  [55, 'var(--confetti-gold)', -2.6, 3.4],
  [63, 'var(--confetti-red)', -1.1, 3.0],
  [71, 'var(--confetti-green)', -0.9, 3.5],
  [79, 'var(--confetti-lilac)', -2.3, 2.9],
  [87, 'var(--light-biru)', -1.6, 3.2],
  [94, 'var(--confetti-gold)', -0.1, 3.7],
  [18, 'var(--confetti-lilac)', -2.9, 3.0],
  [68, 'var(--confetti-green)', -3.1, 2.8],
];

function Hand({ cx, cy, className }: { cx: number; cy: number; className?: string }) {
  return (
    <g className={className}>
      <circle cx={cx} cy={cy} r="10" fill="var(--peek-hand)" stroke="var(--peek-edge)" strokeWidth="1.5" />
    </g>
  );
}

const Feet = () => (
  <>
    <ellipse cx="63" cy="132" rx="13" ry="8" fill="var(--peek-foot)" />
    <ellipse cx="97" cy="132" rx="13" ry="8" fill="var(--peek-foot)" />
  </>
);

/**
 * Peek on the paid page, from the Billing board: he looks up, both hands raised, and
 * jumps -- squashing on landing, his shadow shrinking while he is in the air -- under
 * falling confetti. Decoration only; the same body as everywhere, in his own pose.
 */
export function PaidArt() {
  return (
    <div className={styles.art} data-tone="ok" aria-hidden="true">
      <div className={styles.conf}>
        {CONFETTI.map(([left, color, delay, seconds]) => (
          <i key={`${left}-${color}`} style={{ left: `${left}%`, background: color, animationDelay: `${delay}s`, animationDuration: `${seconds}s` }} />
        ))}
      </div>
      <svg className={`${styles.pk} ${styles.happy}`} viewBox="-14 -6 188 176">
        <defs>
          <clipPath id="result-happy">
            <ellipse cx="80" cy="84" rx="54" ry="49" />
          </clipPath>
        </defs>
        <ellipse className={styles.sh} cx="80" cy="143" rx="40" ry="4" fill="var(--peek-ground-shadow)" />
        <g className={styles.jump}>
          <Feet />
          <Hand cx={20} cy={50} className={styles.armL} />
          <Hand cx={140} cy={50} className={styles.armR} />
          <PeekBody clipId="result-happy" look={{ x: 67, y: 79 }} mouth="smile" />
        </g>
      </svg>
    </div>
  );
}

/**
 * Peek on the failed page: he looks down with a small frown and sways slowly, one hand
 * scratching his head, a sweat drop falling and a "?" bubble pulsing.
 */
export function FailedArt() {
  return (
    <div className={styles.art} data-tone="no" aria-hidden="true">
      <svg className={`${styles.pk} ${styles.sad}`} viewBox="-14 -6 188 176">
        <defs>
          <clipPath id="result-sad">
            <ellipse cx="80" cy="84" rx="54" ry="49" />
          </clipPath>
        </defs>
        <ellipse cx="80" cy="143" rx="40" ry="4" fill="var(--peek-ground-shadow)" />
        <g className={styles.tilt}>
          <Feet />
          <Hand cx={19} cy={104} />
          <Hand cx={132} cy={48} className={styles.scratch} />
          <PeekBody clipId="result-sad" look={{ x: 65, y: 88 }} mouth="frown" />
          <path className={styles.drop} d="M118 70q4 7 0 10q-4-3 0-10z" fill="var(--peek-sweat)" />
        </g>
        <g className={styles.qm}>
          <circle cx="142" cy="20" r="15" fill="var(--light-card)" />
          <text x="140" y="29" textAnchor="middle" fontWeight="800" fontSize="19" fill="var(--light-muted)">
            ?
          </text>
        </g>
      </svg>
    </div>
  );
}

/** The bar over a result page: the wordmark on the left, the way back to Billing on the right. */
export function ResultTop() {
  return (
    <div className={styles.top}>
      <Wordmark />
      <Link href="/app/billing" className={styles.back}>
        Back to Billing
      </Link>
    </div>
  );
}
