'use client';

import { useRef, useState, type CSSProperties } from 'react';
import type { LandingCopy } from './copy.js';
import { LivePeek, type LivePeekHandle } from '../_peek/LivePeek.js';
import calm from './calm.module.css';
import styles from './faq.module.css';

/**
 * Questions an owner asks before signing up (Landing2 board): the first
 * answer open, one open at a time, Peek whistling beside them and hopping
 * when one opens. Every answer stays in the page, collapsed rows included,
 * so the FAQPage structured data always matches what is there.
 */
export function Faq({ copy }: { copy: LandingCopy['faq'] }) {
  const [open, setOpen] = useState<number | null>(0);
  const peek = useRef<LivePeekHandle>(null);
  const toggle = (i: number) => {
    setOpen((o) => (o === i ? null : i));
    if (open !== i) peek.current?.mood('hop', 520);
  };

  return (
    <section id="faq" className={calm.sec} aria-labelledby="faq-title">
      <div className={`${calm.wrap} ${styles.faq}`}>
        <div className={calm.rv} data-rv="">
          <p className={`${calm.lbl} ${calm.left} ${styles.head}`}>{copy.label}</p>
          <h2 id="faq-title" className={`${calm.h2} ${calm.left} ${styles.head}`}>
            {copy.title[0]}
            <br />
            {copy.title[1]}
          </h2>
          <span className={styles.pk}>
            <LivePeek width={124} pose="whistle" ref={peek} />
          </span>
        </div>
        <div className={`${styles.list} ${calm.rv}`} data-rv="" style={{ '--d': '120ms' } as CSSProperties}>
          {copy.items.map((item, i) => (
            <div key={item.q} className={styles.fq} data-open={open === i ? '' : undefined}>
              <button type="button" aria-expanded={open === i} aria-controls={`faq-a-${i}`} onClick={() => toggle(i)}>
                {item.q}
                <i aria-hidden="true" />
              </button>
              <div id={`faq-a-${i}`} className={styles.a}>
                <p>{item.a}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
