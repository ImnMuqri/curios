import type { ReactNode } from 'react';
import styles from './Shell.module.css';

/**
 * The dashboard's measure and padding, in one place.
 *
 * This replaces className="app-shell" in app/layout.tsx, which referenced a
 * class no stylesheet in this repo has ever defined. It styled nothing from
 * the day it was written and nothing ever failed, because a missing class is
 * silent -- which is the argument for components over class-name conventions
 * in one sentence.
 */
export function Shell({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <main className={styles.shell}>
      {title ? <h1 className={styles.title}>{title}</h1> : null}
      {children}
    </main>
  );
}
