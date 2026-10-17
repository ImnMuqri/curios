'use client';

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { COPY, type Locale } from './copy.js';
import { useReducedMotion } from './useReducedMotion.js';
import styles from './tanya.module.css';

/**
 * Room one: the facts surface out of what was pasted, one at a time, each
 * typed out as it is found and marked where it came from. With reduced motion
 * all four are found at once.
 */
export function Found({ locale }: { locale: Locale }) {
  const copy = COPY[locale].how;
  const reduced = useReducedMotion();
  const [at, setAt] = useState({ i: copy.facts.length, n: 0 });

  useEffect(() => {
    if (reduced) {
      setAt({ i: copy.facts.length, n: 0 });
      return;
    }
    let hold = 0;
    let i = 0;
    let n = 0;
    setAt({ i: 0, n: 0 });
    const timer = window.setInterval(() => {
      if (hold > 0) {
        hold -= 1;
        return;
      }
      if (i >= copy.facts.length) {
        i = 0;
        n = 0;
      } else {
        n += 1;
        if (n >= copy.facts[i]!.text.length) {
          i += 1;
          n = 0;
          hold = i >= copy.facts.length ? 60 : 14;
        }
      }
      setAt({ i, n });
    }, 40);
    return () => window.clearInterval(timer);
  }, [reduced, copy.facts]);

  return (
    <div className={styles.pasteGrid}>
      <div className={styles.pasted}>
        <p className={styles.tiny}>{copy.pasted}</p>
        {copy.pastedText.map((part, k) =>
          typeof part === 'string' ? (
            <span key={k}>{part}</span>
          ) : (
            <mark key={k} data-on={part.fact < at.i || (part.fact === at.i && at.n > 0) || undefined}>
              {part.text}
            </mark>
          ),
        )}
      </div>
      <div className={styles.found} aria-live="polite">
        <p className={styles.tiny}>{copy.found}</p>
        {copy.facts.map((fact, k) =>
          k < at.i || (k === at.i && at.n > 0) ? (
            <span key={fact.text} className={styles.fact}>
              <span aria-hidden="true">✓</span>
              <span>{k < at.i ? fact.text : fact.text.slice(0, at.n)}</span>
            </span>
          ) : null,
        )}
      </div>
    </div>
  );
}

/**
 * Room two: the facts as a stack of cards. Approve flings the top one right,
 * Fix it flings it left; on its own it approves one every few seconds.
 */
export function Stack({ locale }: { locale: Locale }) {
  const copy = COPY[locale].how;
  const reduced = useReducedMotion();
  const [state, setState] = useState({ top: 0, fly: null as 'left' | 'right' | null, approved: 0 });
  const busy = useRef(false);
  const total = copy.facts.length;

  const fling = (dir: 'left' | 'right') => {
    if (busy.current) return;
    busy.current = true;
    setState((s) => ({ ...s, fly: dir }));
    window.setTimeout(() => {
      busy.current = false;
      setState((s) => {
        const top = (s.top + 1) % total;
        return { top, fly: null, approved: top === 0 ? 0 : s.approved + (dir === 'right' ? 1 : 0) };
      });
    }, 480);
  };

  useEffect(() => {
    if (reduced) return;
    const timer = window.setInterval(() => fling('right'), 2600);
    return () => window.clearInterval(timer);
    // fling only reads refs and setters, so the timer is set up once per preference.
  }, [reduced]);

  return (
    <div className={styles.stackStage}>
      <div className={styles.stack}>
        {copy.facts.map((fact, k) => {
          const depth = (k - state.top + total) % total;
          const flying = depth === 0 && state.fly;
          const style: CSSProperties = {
            zIndex: total - depth,
            opacity: depth >= 3 ? 0 : 1,
            transform: flying
              ? `translateX(${state.fly === 'right' ? 130 : -130}%) rotate(${state.fly === 'right' ? 16 : -16}deg)`
              : `translateY(${depth * 12}px) scale(${1 - depth * 0.05})`,
          };
          return (
            <div key={fact.text} className={styles.stackCard} style={style} aria-hidden={depth !== 0}>
              <p className={styles.stackMeta}>
                <span>{copy.factOf(k + 1, total)}</span>
                <span>{copy.from}</span>
              </p>
              <p className={styles.stackText}>{fact.text}</p>
              <p className={styles.stackUse}>{copy.usedFor(fact.topic)}</p>
              {flying ? (
                <span className={styles.stamp} data-fix={state.fly === 'left' || undefined}>
                  {state.fly === 'right' ? copy.approvedStamp : copy.fix.replace('← ', '')}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className={styles.stackButtons}>
        <button type="button" className={styles.stackFix} onClick={() => fling('left')}>
          {copy.fix}
        </button>
        <button type="button" className={styles.stackApprove} onClick={() => fling('right')}>
          {copy.approve}
        </button>
      </div>
      <p className={styles.approvedCount} aria-live="polite">
        {copy.approved(state.approved)}
      </p>
    </div>
  );
}

/** Room three's card, tilting toward the pointer. Still for reduced motion and for touch. */
export function Tilt({ children }: { children: React.ReactNode }) {
  const reduced = useReducedMotion();
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (reduced || event.pointerType !== 'mouse') return;
    const box = event.currentTarget.getBoundingClientRect();
    setTilt({ x: ((event.clientY - box.top) / box.height - 0.5) * -14, y: ((event.clientX - box.left) / box.width - 0.5) * 14 });
  };
  return (
    <div className={styles.tiltWrap} onPointerMove={move} onPointerLeave={() => setTilt({ x: 0, y: 0 })}>
      <div className={styles.bioCard} style={{ transform: `rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)` }}>
        {children}
      </div>
    </div>
  );
}
