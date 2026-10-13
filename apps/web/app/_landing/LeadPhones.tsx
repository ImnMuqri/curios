import type { LandingCopy } from './copy.js';
import { BentoPage } from '../_bento/BentoPage.js';
import { DEMO_SHOP, type Demo } from './demo.js';
import { Device } from './Device.js';
import styles from './paid.module.css';

/** '11:42 pm' as a phone's status bar shows it: '11:42'. */
const clock = (time: string) => time.replace(/\s*[ap]m$/i, '');

/**
 * The two phones of the lead story at a given step (1 to 5): the customer's
 * browser, and the owner's lock screen that becomes the email and the
 * one-tap WhatsApp reply. On a narrow screen only the phone the step is
 * happening on shows (the customer's for steps one to three, the owner's for
 * four and five).
 *
 * The capture card and the email reproduce the real product's words
 * (packages/ui CaptureCard, apps/workers notify.ts).
 */
export function LeadPhones({ step, copy, shop }: { step: number; copy: LandingCopy['leads']; shop: Demo }) {
  const DEMO_LEAD = shop.lead;
  const DEMO_PAGE = shop.page;
  const onOwner = step >= 4;
  const shown = (n: number) => (step >= n ? 'yes' : 'no');
  return (
    <div className={styles.phones} data-step={step} data-showing={onOwner ? 'owner' : 'visitor'}>
      {/* ---- The customer's phone: Kek Lina's page, open in a browser ---- */}
      <figure className={styles.device} data-device="visitor">
        <figcaption className={styles.deviceLabel}>{copy.visitorPhone}</figcaption>
        <Device time={clock(DEMO_LEAD.time)} chrome="browser" url="curios.my/keklina">
          <div className={styles.page}>
            {/* Kek Lina's real page -- the one the hero and the storm show -- in chat mode. */}
            <BentoPage {...DEMO_PAGE} mode="chat">
            <div className={styles.chat}>
              <p className={styles.fromVisitor} data-shown={shown(1)}>
                {DEMO_LEAD.question}
              </p>
              <p className={styles.fromPage} data-shown={shown(2)}>
                {DEMO_LEAD.answer}
              </p>
              <div className={styles.capture} data-shown={shown(3)}>
                <p className={styles.captureLead}>Want {DEMO_SHOP} to message you back?</p>
                <p className={styles.captureLabel}>Your WhatsApp number</p>
                <p className={styles.captureField}>{DEMO_LEAD.phone}</p>
                <p className={styles.captureButton}>Send my number</p>
              </div>
              <p className={styles.captureDone} data-shown={shown(4)}>
                Got it. {DEMO_SHOP} will message you on WhatsApp.
              </p>
            </div>
            </BentoPage>
          </div>
        </Device>
      </figure>

      {/* ---- The owner's phone: locked until the lead lands, then the email ---- */}
      <figure className={styles.device} data-device="owner">
        <figcaption className={styles.deviceLabel}>{copy.ownerPhone}</figcaption>
        <Device
          time={clock(step < 4 ? DEMO_LEAD.time : DEMO_LEAD.emailTime)}
          chrome="mail"
          mailTitle="Curios"
          tone={step < 4 ? 'dark' : 'light'}
          overlay={
            <div className={styles.lock} data-shown={step < 4 ? 'yes' : 'no'}>
              <p className={styles.lockDate}>{copy.lockDate}</p>
              <p className={styles.lockTime}>{clock(DEMO_LEAD.time)}</p>
              <p className={styles.asleep}>{copy.asleep}</p>
            </div>
          }
        >
          <article className={styles.email} data-shown={shown(4)}>
            <p className={styles.emailFrom}>
              <span>Curios</span>
              <span>{DEMO_LEAD.emailTime}</span>
            </p>
            <p className={styles.emailSubject}>New lead for {DEMO_SHOP}</p>
            <p className={styles.emailLine}>Someone asked about your page and left their number.</p>
            <dl className={styles.emailFacts}>
              <dt>Number</dt>
              <dd className={styles.money}>{DEMO_LEAD.phone}</dd>
              <dt>Product</dt>
              <dd>{DEMO_LEAD.product}</dd>
              <dt>When</dt>
              <dd>{DEMO_LEAD.when}</dd>
              <dt>Where</dt>
              <dd>{DEMO_LEAD.where}</dd>
            </dl>
            <p className={styles.emailReply} data-pulse={step === 5 ? 'yes' : 'no'}>
              Reply on WhatsApp
            </p>
            <p className={styles.emailLine}>What they asked:</p>
            <p className={styles.emailTranscript}>
              Customer: {DEMO_LEAD.question}
              <br />
              {DEMO_SHOP}: {DEMO_LEAD.answer}
            </p>
          </article>
          <div className={styles.whatsapp} data-shown={shown(5)}>
            <p className={styles.whatsappTo}>{DEMO_LEAD.phone}</p>
            <p className={styles.whatsappDraft}>{DEMO_LEAD.reply}</p>
          </div>
        </Device>
      </figure>
    </div>
  );
}
