import type { CSSProperties } from 'react';
import type { PersonaWords } from './copy.js';
import type { Persona } from './personas.js';
import { photo } from './photos.js';
import calm from './calm.module.css';
import styles from './page-card.module.css';

/**
 * A Curios page drawn as a card (Landing2 board, L2:110–142): the owner's
 * deep colour under their photo, their name in their own font, the icons,
 * Links and Ask, and the ask bar. On Ask it shows the question, then the
 * answer as far as it has been typed. The drawing is hidden from assistive
 * tech; a side card is a button that brings it to the front.
 */
export function PageCard({
  persona,
  words,
  kind,
  labels,
  ask,
  q,
  dots = false,
  answer,
  typing = false,
  slot,
  label,
  onPick,
}: {
  persona: Persona;
  words: PersonaWords;
  /** The badge in the corner: "Personal", "Business". */
  kind: string;
  labels: { links: string; ask: string; askAnything: (name: string) => string; reply: (name: string) => string };
  ask: boolean;
  q: boolean;
  dots?: boolean;
  answer: string;
  typing?: boolean;
  /** The deck slot, -2…2, the front at 0. */
  slot: number;
  /** A side card's accessible name, "Show Kek Lina’s page". */
  label?: string;
  onPick?: () => void;
}) {
  const vars = { background: persona.deep, '--acc': persona.accent } as CSSProperties;
  const body = (
    <>
      {persona.photo ? (
        <span className={styles.photo}>
          <img {...photo(persona.photo.src, 300)} alt={persona.name} style={{ objectPosition: persona.photo.focus }} loading="lazy" />
        </span>
      ) : null}
      <span className={styles.kind}>{kind}</span>
      <span className={styles.body}>
        <span className={styles.name} style={{ fontFamily: persona.font }}>
          {persona.name}
        </span>
        <span className={styles.handle}>curios.my/{persona.handle}</span>
        <span className={styles.icons}>
          <svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="0.6" /></svg>
          <svg viewBox="0 0 24 24"><path d="M4 20l1.4-4.2A8 8 0 1 1 8.6 19z" /></svg>
          <svg viewBox="0 0 24 24"><path d="M14 3v11.5a3.5 3.5 0 1 1-3.5-3.5" /><path d="M14 3c.6 2.6 2.4 4 5 4" /></svg>
          <svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></svg>
        </span>
        <span className={styles.tabs}>
          <span>{labels.links}</span>
          <span>{labels.ask}</span>
        </span>
        <span className={styles.mid}>
          <span className={styles.links}>
            {words.links.map((link) => (
              <span key={link}>
                <span className={styles.in}>{link}</span>
              </span>
            ))}
          </span>
          <span className={styles.chat}>
            <span className={styles.q} data-in={q ? '' : undefined}>
              {words.q}
            </span>
            <span className={styles.a} data-in={dots || answer ? '' : undefined} data-who={labels.reply(persona.short)}>
              {dots ? (
                <span className={calm.tdots}>
                  <i />
                  <i />
                  <i />
                </span>
              ) : (
                <>
                  {answer}
                  {typing ? <span className={calm.caret} /> : null}
                </>
              )}
            </span>
          </span>
        </span>
        <span className={styles.askBar}>
          {labels.askAnything(persona.short)}
          <span className={styles.send}>
            <svg viewBox="0 0 24 24">
              <path d="M12 19V5M6 11l6-6 6 6" />
            </svg>
          </span>
        </span>
      </span>
    </>
  );
  const common = { className: styles.pc, style: vars, 'data-k': persona.key, 'data-s': String(slot), 'data-ask': ask ? '' : undefined };
  return onPick ? (
    <button type="button" {...common} onClick={onPick} aria-label={label}>
      <span aria-hidden="true" className={styles.draw}>
        {body}
      </span>
    </button>
  ) : (
    <div {...common} aria-hidden="true">
      {body}
    </div>
  );
}
