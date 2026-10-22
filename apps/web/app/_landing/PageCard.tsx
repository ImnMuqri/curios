import type { CSSProperties, ReactNode } from 'react';
import type { PersonaWords } from './copy.js';
import type { Persona } from './personas.js';
import styles from './tanya.module.css';

/**
 * A Curios page drawn as a card: the owner's deep colour, their name in their
 * heading font, the social icons, Links and Ask, and the ask bar at its foot.
 * On Ask it shows one question and the answer (`answer`, which the hero types
 * out); on Links, three pill links. Decoration: the whole card is hidden from
 * assistive tech, and whatever places it says what it shows. Spans only, so
 * it can sit inside the hero's button.
 */
export function PageCard({
  persona,
  words,
  view,
  labels,
  answer,
  typing = false,
  kind,
  icons = true,
  className,
  style,
  tabExtra,
}: {
  persona: Persona;
  words: PersonaWords;
  view: 'links' | 'ask';
  labels: { links: string; ask: string; askAnything: (name: string) => string };
  /** The answer as far as it has been typed; the whole answer when left out. */
  answer?: string;
  typing?: boolean;
  /** The badge in the corner: "Personal", "Business". */
  kind?: string;
  icons?: boolean;
  className?: string;
  style?: CSSProperties;
  /** Drawn inside the Ask tab: the hero's cursor and its ripple. */
  tabExtra?: ReactNode;
}) {
  return (
    <span
      className={`${styles.pc} ${className ?? ''}`}
      style={{ ...style, '--pc-deep': persona.deep, '--pc-accent': persona.accent, '--pc-warm': persona.warm } as CSSProperties}
      aria-hidden="true"
      data-photo={persona.photo ? '' : undefined}
    >
      {persona.photo ? (
        <span className={styles.pcPhoto}>
          <img src={persona.photo.src} alt="" style={{ objectPosition: persona.photo.focus }} loading="lazy" />
        </span>
      ) : null}
      {kind ? <span className={styles.pcKind}>{kind}</span> : null}
      <span className={styles.pcBody}>
        <span className={styles.pcName} style={{ fontFamily: persona.font }}>
          {persona.name}
        </span>
        <span className={styles.pcHandle}>curios.my/{persona.handle}</span>
        {icons ? (
          <span className={styles.pcIcons}>
            <svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="0.6" /></svg>
            <svg viewBox="0 0 24 24"><path d="M4 20l1.4-4.2A8 8 0 1 1 8.6 19z" /></svg>
            <svg viewBox="0 0 24 24"><path d="M14 3v11.5a3.5 3.5 0 1 1-3.5-3.5" /><path d="M14 3c.6 2.6 2.4 4 5 4" /></svg>
            <svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></svg>
          </span>
        ) : null}
        <span className={styles.pcTabs}>
          <span data-on={view === 'links' || undefined}>{labels.links}</span>
          <span data-on={view === 'ask' || undefined} className={styles.pcTabAsk}>
            {labels.ask}
            {tabExtra}
          </span>
        </span>
        {view === 'ask' ? (
          <span className={styles.pcChat}>
            <span className={styles.pcQ}>{words.q}</span>
            <span className={styles.pcA} data-who={`${persona.name}’s page`}>
              {answer ?? words.a}
              {typing ? <span className={styles.caret} /> : null}
            </span>
          </span>
        ) : (
          <span className={styles.pcLinks}>
            {words.links.map((link) => (
              <span key={link}>
                <span>{link}</span>
              </span>
            ))}
          </span>
        )}
        <span className={styles.pcAsk}>
          {labels.askAnything(persona.short)}
          <span className={styles.pcSend}>
            <svg viewBox="0 0 24 24" width="14" height="14">
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </span>
        </span>
      </span>
    </span>
  );
}
