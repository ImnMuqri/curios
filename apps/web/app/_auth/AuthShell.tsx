import type { ReactNode } from 'react';
import { AnswerBubble } from '@curios/ui';
import '../_landing/landing-tokens.css';
import { BentoPage } from '../_bento/BentoPage.js';
import { DEMO_EN } from '../_landing/demo.js';

// The sign-in screens are English, so their demo is too.
const DEMO_PAGE = DEMO_EN.page;
const DEMO_QA = DEMO_EN.qa;
import { Device } from '../_landing/Device.js';
import { Wordmark } from '../_landing/Wordmark.js';
import { plexSans } from '../_landing/plex.js';
import base from '../_landing/landing.module.css';
import styles from '../auth.module.css';

/**
 * The frame for the five screens outside the dashboard -- sign in, sign up,
 * forgot, reset, verify -- in the landing page's look, so the step from
 * "Create your free page" to the form feels like the same place.
 *
 * Left: the form on paper, under the wordmark. Right, on wide screens: a biru
 * band with the same demo phone the landing page shows, Kek Lina's page
 * answering "berapa harga". It is static here (no ticker, no streaming): the
 * form is the job on these screens.
 *
 * Server-safe, so the client forms render it directly. `switchTo` is the
 * link under the form to the other way in ("Create your free page" from sign
 * in, "Sign in" from sign up); screens with their own next step leave it out.
 */
export function AuthShell({
  title,
  lede,
  switchTo,
  children,
}: {
  title: string;
  lede?: string;
  switchTo?: { prompt: string; label: string; href: string };
  children: ReactNode;
}) {
  const qa = DEMO_QA[0]!;

  return (
    <div className={`${base.page} ${plexSans.variable} ${styles.auth}`} data-landing>
      <main className={styles.panel}>
        <a href="/" className={styles.brand}>
          <Wordmark />
          <span className={base.srOnly}>Curios home</span>
        </a>

        <div className={styles.body}>
          <h1 className={styles.title}>{title}</h1>
          {lede ? <p className={styles.lede}>{lede}</p> : null}
          <div className={styles.content}>{children}</div>
          {switchTo ? (
            <p className={styles.switch}>
              {switchTo.prompt} <a href={switchTo.href}>{switchTo.label}</a>
            </p>
          ) : null}
        </div>
      </main>

      <aside className={`${base.bandBiru} ${styles.aside}`} aria-hidden="true">
        <p className={styles.asideTitle}>Your link in bio answers “berapa harga” for you.</p>
        <div className={styles.asidePhone}>
          <Device time="3:15" chrome="browser" url={`curios.my/${DEMO_PAGE.handle}`}>
            <div className={styles.asideScreen}>
              <BentoPage {...DEMO_PAGE}>
                <div className={styles.asideThread}>
                  <p className={styles.asideAsked}>{qa.q}</p>
                  <AnswerBubble text={qa.a} />
                </div>
              </BentoPage>
            </div>
          </Device>
        </div>
      </aside>
    </div>
  );
}
