import type { LandingCopy } from './copy.js';
import { PhotoSlot } from './PhotoSlot.js';
import { Reveal } from './Reveal.js';
import base from './landing.module.css';
import styles from './setup.module.css';

/**
 * Objection two: "I don't have time to set this up." Four steps, numbered
 * because they are a real sequence, beside a photograph (to come) of an owner
 * doing step two. Step two says plainly what does not work (Instagram,
 * TikTok) so nobody finds out at the paste box.
 */
export function Setup({ copy }: { copy: LandingCopy }) {
  return (
    <section className={`${base.bandPaper} ${styles.setup}`} id="how" aria-labelledby="setup-title">
      <div className={`${base.wrap} ${styles.grid}`}>
        <div>
          <Reveal>
            <h2 id="setup-title" className={base.h2}>
              {copy.setup.title}
            </h2>
          </Reveal>
          <ol className={styles.steps}>
            {copy.setup.steps.map((step, i) => (
              <Reveal as="li" key={step.title} className={styles.step} delay={i * 60}>
                <span className={styles.number} aria-hidden="true">
                  {i + 1}
                </span>
                <h3 className={styles.title}>{step.title}</h3>
                <p className={styles.body}>{step.body}</p>
                {i === 0 ? <p className={styles.address}>{copy.setup.addressExample}</p> : null}
              </Reveal>
            ))}
          </ol>
        </div>
        <PhotoSlot
          shot={copy.photos.setup}
          src="/landing/setup-laptop.webp"
          alt="A shop owner at her kitchen table, typing on a laptop, her phone and a cup of teh tarik beside it"
          // A landscape photo in a portrait frame: centred on her hands, the laptop and the phone.
          focus="60% 50%"
          ratio={4 / 5}
          className={styles.photo}
        />
      </div>
    </section>
  );
}
