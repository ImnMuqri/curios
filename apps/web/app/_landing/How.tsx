import { COPY, type Locale } from './copy.js';
import { Found, Stack, Tilt } from './HowParts.js';
import styles from './tanya.module.css';

/**
 * How it works, in three rooms. Where the browser has scroll-driven
 * animations (and motion is welcome), the section pins and the rooms slide
 * sideways as the page scrolls; anywhere else they are a row to swipe.
 */
export function How({ locale }: { locale: Locale }) {
  const copy = COPY[locale].how;
  const [one, two, three] = copy.steps;
  return (
    <section id="how" className={styles.how}>
      <div className={styles.howPin}>
        <div className={styles.wrap}>
          <div className={styles.howHead}>
            <div>
              <p className={styles.eyebrow}>{copy.eyebrow}</p>
              <h2 className={styles.h2}>{copy.title}</h2>
            </div>
            <div className={styles.howDots} aria-hidden="true">
              <span className={styles.howRail}>
                <span className={styles.howFill} />
              </span>
              <span className={`${styles.howDot} ${styles.howDotOn}`}>1</span>
              <span className={`${styles.howDot} ${styles.howD2}`}>2</span>
              <span className={`${styles.howDot} ${styles.howD3}`}>3</span>
            </div>
          </div>

          <div className={styles.howView}>
            <ol className={styles.howTrack}>
              <li className={styles.howSlide}>
                <div className={`${styles.room} ${styles.room1}`}>
                  <span className={styles.roomN} aria-hidden="true">01</span>
                  <div className={styles.roomText}>
                    <h3 className={styles.roomH}>{one!.title}</h3>
                    <p className={styles.roomP}>{one!.body}</p>
                  </div>
                  <div className={styles.roomStage}>
                    <Found locale={locale} />
                  </div>
                </div>
              </li>

              <li className={styles.howSlide}>
                <div className={`${styles.room} ${styles.room2}`}>
                  <span className={styles.roomN} aria-hidden="true">02</span>
                  <div className={styles.roomText}>
                    <h3 className={styles.roomH}>{two!.title}</h3>
                    <p className={styles.roomP}>{two!.body}</p>
                  </div>
                  <div className={styles.roomStage}>
                    <Stack locale={locale} />
                  </div>
                </div>
              </li>

              <li className={styles.howSlide}>
                <div className={`${styles.room} ${styles.room3}`}>
                  <span className={styles.roomN} aria-hidden="true">03</span>
                  <div className={styles.roomText}>
                    <h3 className={styles.roomH}>{three!.title}</h3>
                    <p className={styles.roomP}>{three!.body}</p>
                  </div>
                  <div className={`${styles.roomStage} ${styles.bioStage}`}>
                    <div className={styles.ring} aria-hidden="true">
                      <svg viewBox="0 0 200 200">
                        <path id="ring-path" d="M100,100 m-82,0 a82,82 0 1,1 164,0 a82,82 0 1,1 -164,0" fill="none" />
                        <text>
                          <textPath href="#ring-path">{copy.ring}</textPath>
                        </text>
                      </svg>
                      <span className={styles.ringFace}>A</span>
                    </div>
                    <Tilt>
                      <p className={styles.bioWho}>
                        <span className={styles.bioFace} aria-hidden="true">A</span>
                        <span>
                          <b>{copy.card.name}</b>
                          <span>{copy.card.role}</span>
                        </span>
                      </p>
                      <p className={styles.bioText}>{copy.card.bio}</p>
                      <p className={styles.bioLink}>
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
                          <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
                        </svg>
                        curios.my/aisyahdraws
                      </p>
                    </Tilt>
                  </div>
                </div>
              </li>
            </ol>
          </div>
          <p className={styles.keep} aria-hidden="true">{copy.keep}</p>
        </div>
      </div>
    </section>
  );
}
