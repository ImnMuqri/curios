import type { LandingCopy } from './copy.js';
import { Reveal } from './Reveal.js';
import base from './landing.module.css';
import styles from './quiet.module.css';

/** The quiet parts: three small things that save the owner later. Three cards, no pictures. */
export function QuietParts({ copy }: { copy: LandingCopy }) {
  return (
    <section className={`${base.bandSurface} ${styles.quiet}`} id="quiet" aria-labelledby="quiet-title">
      <div className={base.wrap}>
        <Reveal>
          <h2 id="quiet-title" className={base.h2}>
            {copy.quiet.title}
          </h2>
        </Reveal>
        <ul className={styles.tiles}>
          {copy.quiet.tiles.map((tile, i) => (
            <Reveal as="li" key={tile.title} className={styles.tile} delay={i * 60}>
              <h3 className={styles.title}>{tile.title}</h3>
              <p className={styles.body}>{tile.body}</p>
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  );
}
