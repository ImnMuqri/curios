import { LivePeek, type PeekMood } from '../_peek/LivePeek.js';
import styles from './system.module.css';

/*
 * The Site board's art for a system screen: Peek, full body, in a mood, with a
 * round badge at his shoulder (a tick, a clock, an envelope, a plug, a lock, a
 * flag, a question mark) or, while something loads, three dots. One component
 * and a few named screens; the colours are classes, so they come from tokens.
 */

const ICON = {
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="3" />
      <path d="M3.5 7l8.5 6 8.5-6" />
    </>
  ),
  plug: <path d="M9 3v5M15 3v5M7 8h10v3a5 5 0 0 1-10 0zM12 16v5" />,
  lock: (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2.5" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  flag: <path d="M5 21V4h11l-1.5 4L16 12H5" />,
};

type Icon = keyof typeof ICON | 'question';
const TONE: Record<Icon, string | undefined> = {
  check: styles.ok,
  clock: styles.or,
  mail: styles.bl,
  plug: styles.or,
  lock: undefined,
  flag: styles.or,
  question: styles.q,
};

export function SystemArt({
  mood = null,
  wave = false,
  follow = false,
  icon,
  loading = false,
}: {
  /** Which mood Peek holds: happy, sad, tilt... none is the calm default. */
  mood?: PeekMood | null;
  wave?: boolean;
  /** His eyes follow the pointer (not with `sad`, whose eyes stay down). */
  follow?: boolean;
  icon?: Icon;
  loading?: boolean;
}) {
  return (
    <div className={styles.art} aria-hidden="true" data-mood={mood ?? (wave ? 'wave' : 'calm')}>
      <LivePeek width={140} className={styles.pk} follow={follow} pose={wave ? 'wave' : 'idle'} held={mood} />
      {loading ? (
        <span className={styles.wait}>
          <i />
          <i />
          <i />
        </span>
      ) : null}
      {icon ? (
        <span className={`${styles.badge} ${TONE[icon] ?? ''}`}>
          {icon === 'question' ? (
            '?'
          ) : (
            <svg viewBox="0 0 24 24">{ICON[icon]}</svg>
          )}
        </span>
      ) : null}
    </div>
  );
}

/** Confirming an address: Peek watching, three dots. */
export const VerifyingArt = () => <SystemArt follow loading />;
/** Confirmed, password changed, report sent: Peek happy, a green tick. */
export const DoneArt = () => <SystemArt mood="happy" icon="check" />;
/** A link that ran out: Peek sad, a clock. */
export const ExpiredArt = () => <SystemArt mood="sad" icon="clock" />;
/** An email on its way: Peek waving, an envelope. */
export const SentArt = () => <SystemArt wave icon="mail" />;
/** A link that does not work: Peek tilting his head, a question mark. */
export const BrokenLinkArt = () => <SystemArt mood="tilt" icon="question" />;
/** Something broke on our side: Peek sad, a plug. */
export const UnpluggedArt = () => <SystemArt mood="sad" icon="plug" />;
/** A suspended page: Peek watching, a lock. */
export const LockedArt = () => <SystemArt follow icon="lock" />;
/** Report a page: Peek watching, a flag. */
export const FlagArt = () => <SystemArt follow icon="flag" />;
