import type { LandingCopy } from './copy.js';
import { PhotoSlot } from './PhotoSlot.js';
import { Reveal } from './Reveal.js';
import base from './landing.module.css';
import styles from './how.module.css';

/** Three steps, each with a small piece of the real product drawn in its card. */
export function HowItWorks({ copy }: { copy: LandingCopy }) {
  const facts = copy.shop.facts.slice(0, 3);
  const snippets = [
    <p key="source" className={styles.source} data-snippet>
      keklina.example/menu
    </p>,
    <ul key="facts" className={styles.facts} data-snippet>
      {facts.map((fact, i) => (
        <li key={fact.claim} data-ticked={i === 0 ? 'yes' : 'no'}>
          <span className={styles.claim}>{fact.claim}</span> <span className={styles.value}>{fact.value}</span>
        </li>
      ))}
    </ul>,
    <p key="link" className={styles.link} data-snippet>
      curios.my/{copy.shop.page.handle}
    </p>,
  ];
  return (
    <section className={`${base.bandSurface} ${styles.how}`} id="how" aria-labelledby="how-title">
      <div className={base.wrap}>
        <Reveal>
          <h2 id="how-title" className={base.h2}>
            {copy.how.title}
          </h2>
        </Reveal>
        <PhotoSlot
          shot={copy.photos.setup}
          src="/landing/setup-laptop.webp"
          alt=""
          focus="60% 50%"
          ratio={21 / 9}
          className={styles.photo}
        />
        <ol className={styles.steps}>
          {copy.how.steps.map((step, i) => (
            <Reveal as="li" key={step.title} className={styles.card} delay={i * 60}>
              <span className={styles.number} aria-hidden="true">
                {String(i + 1).padStart(2, '0')}
              </span>
              <h3 className={styles.title}>{step.title}</h3>
              <p className={styles.body}>{step.body}</p>
              {snippets[i]}
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  );
}
