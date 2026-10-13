import type { LandingCopy } from './copy.js';
import { Reveal } from './Reveal.js';
import { ShopDemo } from './ShopDemo.js';
import base from './landing.module.css';
import styles from './shop.module.css';

export function ShopSection({ copy }: { copy: LandingCopy }) {
  return (
    <section className={`${base.bandPaper} ${styles.shop}`} id="shop" aria-labelledby="shop-title">
      <div className={`${base.wrap} ${styles.grid}`}>
        <Reveal className={styles.text}>
          <h2 id="shop-title" className={base.h2}>{copy.shopSection.title}</h2>
          <ul className={styles.points}>
            {copy.shopSection.points.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
        </Reveal>
        <ShopDemo copy={copy} />
      </div>
    </section>
  );
}
