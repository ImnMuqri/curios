import type { ElementType, ReactNode } from 'react';
import styles from './Shell.module.css';

/**
 * The dashboard's measure and padding, in one place.
 *
 * This replaces className="app-shell" in app/layout.tsx, which referenced a
 * class no stylesheet in this repo has ever defined. It styled nothing from
 * the day it was written and nothing ever failed, because a missing class is
 * silent -- which is the argument for components over class-name conventions
 * in one sentence.
 *
 * `as` defaults to `'main'`, because most callers are the one screen on the
 * page. AppFrame (slice 13) puts its own `<main>` around My Curios, Review,
 * Settings and the rest, so Billing, Leads and Questions -- which already
 * render this inside that frame -- pass `as="div"` to avoid a second, nested
 * landmark.
 */
export function Shell({
  as: As = 'main',
  title,
  lede,
  children,
}: {
  as?: ElementType;
  title?: string;
  /** One line under the title saying what this screen is for. */
  lede?: ReactNode;
  children: ReactNode;
}) {
  return (
    <As className={styles.shell}>
      {title ? <h1 className={styles.title}>{title}</h1> : null}
      {lede ? <p className={styles.lede}>{lede}</p> : null}
      {children}
    </As>
  );
}
