'use client';

import { useState } from 'react';
import { SOCIAL_KINDS, normalizeSocial, type SocialKind, type Socials } from '@curios/core/socials';
import type { MyCurios } from '@curios/db-read';
import { useAutosave } from '../_ui/use-autosave.js';
import { SaveState } from '../_ui/save-state.js';
import { SectionHead } from '../_ui/section-head.js';
import ui from '../_ui/editor.module.css';
import styles from './curios.module.css';

type Profiles = MyCurios['socials'];

const FIELDS: Record<SocialKind, { label: string; prefix: string; placeholder: string; d: string; refused: string }> = {
  instagram: {
    label: 'Instagram',
    prefix: 'instagram.com/',
    placeholder: 'yourname',
    d: 'M7 3h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM17.5 6.5h.01',
    refused: 'That doesn’t look like an Instagram name.',
  },
  whatsapp: {
    label: 'WhatsApp',
    prefix: 'wa.me/',
    placeholder: '601xxxxxxxx',
    d: 'M4 20l1.4-4.2A8 8 0 1 1 8.6 19z',
    refused: 'That doesn’t look like a WhatsApp number.',
  },
  tiktok: {
    label: 'TikTok',
    prefix: 'tiktok.com/@',
    placeholder: 'yourname',
    d: 'M14 3v11.5a3.5 3.5 0 1 1-3.5-3.5M14 3c.6 2.6 2.4 4 5 4',
    refused: 'That doesn’t look like a TikTok name.',
  },
  email: { label: 'Email', prefix: '', placeholder: 'you@example.com', d: 'M3 5h18v14H3zM3 7l9 6 9-6', refused: 'That doesn’t look like an email address.' },
  facebook: {
    label: 'Facebook',
    prefix: 'facebook.com/',
    placeholder: 'yourpage',
    d: 'M14 8h3V4h-3a4 4 0 0 0-4 4v3H7v4h3v6h4v-6h3l1-4h-4V8z',
    refused: 'That doesn’t look like a Facebook page.',
  },
  youtube: {
    label: 'YouTube',
    prefix: 'youtube.com/@',
    placeholder: 'yourchannel',
    d: 'M3 8a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3zM10 9l5 3-5 3z',
    refused: 'That doesn’t look like a YouTube channel.',
  },
};

/** The profiles with one changed (or cleared), in display order. */
function withProfile(profiles: Profiles, kind: SocialKind, value: string): Profiles {
  const rest = profiles.filter((p) => p.kind !== kind);
  const next = value === '' ? rest : [...rest, { kind, value }];
  return SOCIAL_KINDS.flatMap((k) => next.filter((p) => p.kind === k));
}

/**
 * Social profiles, shown as icons under the owner's name. Each field takes a
 * handle, a number or a pasted profile link; what is stored is the handle,
 * and the preview shows the icon as soon as it reads as one.
 */
export function SocialsEditor({
  socials,
  onChange,
  save,
}: {
  socials: Profiles;
  onChange: (socials: Profiles) => void;
  save: (patch: { socials: Socials }) => Promise<unknown>;
}) {
  return (
    <section className={ui.section} aria-labelledby="socials-title">
      <SectionHead id="socials-title" title="Social profiles" note="Shown as icons under your name." />
      <div className={styles.socials}>
        {SOCIAL_KINDS.map((kind) => (
          <SocialField
            key={kind}
            kind={kind}
            stored={socials.find((p) => p.kind === kind)?.value ?? ''}
            onValue={(value) => onChange(withProfile(socials, kind, value))}
            save={(value) => save({ socials: { [kind]: value } })}
          />
        ))}
      </div>
    </section>
  );
}

function SocialField({
  kind,
  stored,
  onValue,
  save,
}: {
  kind: SocialKind;
  stored: string;
  onValue: (value: string) => void;
  save: (value: string) => Promise<unknown>;
}) {
  const field = FIELDS[kind];
  const [text, setText] = useState(stored);
  const [refused, setRefused] = useState(false);
  const autosave = useAutosave(save);

  function change(raw: string) {
    setText(raw);
    const value = normalizeSocial(kind, raw);
    // Said on blur, not mid-typing: half a handle is not a mistake yet.
    setRefused(false);
    if (value === null) return;
    onValue(value);
    autosave.schedule(value);
  }

  return (
    <div className={styles.socialCell}>
      <label className={styles.social} data-kind={kind} data-refused={refused}>
        <span className={styles.socialIcon} aria-hidden="true">
          <svg viewBox="0 0 24 24" width="16" height="16">
            <path d={field.d} />
          </svg>
        </span>
        {field.prefix ? <span className={styles.socialPrefix} aria-hidden="true">{field.prefix}</span> : null}
        <input
          value={text}
          placeholder={field.placeholder}
          aria-label={field.label}
          aria-invalid={refused || undefined}
          autoComplete="off"
          spellCheck={false}
          inputMode={kind === 'whatsapp' ? 'tel' : kind === 'email' ? 'email' : 'text'}
          onChange={(event) => change(event.target.value)}
          onBlur={() => {
            const value = normalizeSocial(kind, text);
            if (value === null) setRefused(true);
            // A pasted link or an @name settles into the handle that was saved.
            else if (value !== text) setText(value);
          }}
        />
      </label>
      {refused ? (
        <p className={ui.saveError} role="alert">
          {field.refused}
        </p>
      ) : (
        <SaveState status={autosave.status} error={autosave.error} retry={autosave.retry} />
      )}
    </div>
  );
}
