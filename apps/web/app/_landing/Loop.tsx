'use client';

import { useId } from 'react';
import { useReducedMotion } from './useReducedMotion.js';
import styles from './tanya.module.css';

/**
 * The page's refrain running along a curve between sections. Scaled, never
 * stretched (`slice`), so the letters keep their shape at any width; a narrow
 * screen sees less of the curve. Decoration; it stops for reduced motion.
 */
export function Loop({ text }: { text: string }) {
  const reduced = useReducedMotion();
  const id = useId().replace(/:/g, '');
  return (
    <div className={styles.loop} aria-hidden="true">
      <svg viewBox="0 0 1440 180" preserveAspectRatio="xMidYMid slice">
        <path id={`loop-${id}`} d="M -200 120 Q 360 10 720 90 T 1640 70" fill="none" />
        <text>
          <textPath href={`#loop-${id}`} startOffset="0%">
            {text.repeat(5)}
            {reduced ? null : <animate attributeName="startOffset" from="0%" to="-50%" dur="40s" repeatCount="indefinite" />}
          </textPath>
        </text>
      </svg>
    </div>
  );
}
