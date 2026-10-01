'use client';

import { useState } from 'react';
import { Button, Callout } from '@curios/ui';
import { ACCENT_PRESETS, HEADING_FONTS, isHexColor, type HeadingFont, type PageStyle } from '@curios/core/bento';
import { HEADING_FONT_VAR } from '../../../lib/heading-fonts.js';
import type { AppearancePatch } from './my-curios.js';
import styles from './curios.module.css';

const FONT_NAMES: Record<HeadingFont, string> = {
  JAKARTA: 'Jakarta',
  BRICOLAGE: 'Bricolage',
  FRAUNCES: 'Fraunces',
  SPACE_GROTESK: 'Space Grotesk',
  DM_SERIF: 'DM Serif',
  OUTFIT: 'Outfit',
};

// A hex string is not a name -- "Accent #0c7a62" tells a screen-reader user
// nothing a sighted owner does not already get for free from the swatch's
// colour. One name per preset, in `ACCENT_PRESETS`' order; the hex still
// shows, as the swatch's `title`, for whoever wants it.
const ACCENT_NAMES: Record<string, string> = {
  '#0c7a62': 'Hijau',
  '#1f4fd1': 'Blue',
  '#6d3fb3': 'Purple',
  '#c2185b': 'Magenta',
  '#d8452f': 'Red',
  '#e08a1e': 'Amber',
  '#2d6a4f': 'Forest',
  '#10231f': 'Ink',
};

/**
 * Style, accent and heading font. Each choice is a single click, so it saves
 * at once rather than on a debounce. A custom colour saves only once it is a
 * valid hex; text on it is made readable by the page, not by the owner.
 */
export function AppearanceEditor({
  style,
  accentColor,
  headingFont,
  onChange,
  save,
}: {
  style: PageStyle;
  accentColor: string;
  headingFont: HeadingFont;
  onChange: (change: AppearancePatch) => void;
  save: (patch: AppearancePatch) => Promise<unknown>;
}) {
  const [custom, setCustom] = useState(accentColor);
  const [error, setError] = useState('');
  // The patch a failed save should send again. Cleared on success, replaced
  // by whatever the owner tries next -- retry always sends the latest
  // failed change, never a stale one.
  const [failedPatch, setFailedPatch] = useState<AppearancePatch | null>(null);

  const attempt = (patch: AppearancePatch) => {
    save(patch)
      .then(() => {
        setError('');
        setFailedPatch(null);
      })
      .catch(() => {
        setError('That did not save. Try again.');
        setFailedPatch(patch);
      });
  };

  const choose = (patch: AppearancePatch) => {
    setError('');
    onChange(patch);
    attempt(patch);
  };

  const retry = () => {
    if (failedPatch) attempt(failedPatch);
  };

  return (
    <section className={styles.section} aria-labelledby="appearance-title">
      <h2 id="appearance-title" className={styles.sectionTitle}>Appearance</h2>

      <fieldset className={styles.fieldset}>
        <legend>Style</legend>
        <div className={styles.segment}>
          {(['SOFT', 'CONTRAST'] as const).map((value) => (
            <label key={value} data-checked={style === value}>
              <input type="radio" name="style" checked={style === value} onChange={() => choose({ style: value })} />
              {value === 'SOFT' ? 'Soft' : 'High contrast'}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className={styles.fieldset}>
        <legend>Accent colour</legend>
        <div className={styles.swatches}>
          {ACCENT_PRESETS.map((hex) => (
            <label key={hex} className={styles.swatch} style={{ background: hex }} title={hex} data-checked={accentColor === hex}>
              <input type="radio" name="accent" aria-label={ACCENT_NAMES[hex] ?? hex} checked={accentColor === hex} onChange={() => { setCustom(hex); choose({ accentColor: hex }); }} />
            </label>
          ))}
        </div>
        <label className={styles.custom}>
          Custom colour
          <input
            value={custom}
            onChange={(event) => {
              const value = event.target.value.trim();
              setCustom(value);
              if (isHexColor(value)) choose({ accentColor: value.toLowerCase() });
              else {
                // Not a failed save -- nothing was sent -- so there is
                // nothing for a Retry button here to resend.
                setError('Type a colour as six-digit hex, like #0c7a62.');
                setFailedPatch(null);
              }
            }}
          />
        </label>
      </fieldset>

      <fieldset className={styles.fieldset}>
        <legend>Heading font</legend>
        <div className={styles.fonts}>
          {HEADING_FONTS.map((font) => (
            <label key={font} style={{ fontFamily: HEADING_FONT_VAR[font] }} data-checked={headingFont === font}>
              <input type="radio" name="font" checked={headingFont === font} onChange={() => choose({ headingFont: font })} />
              {FONT_NAMES[font]}
            </label>
          ))}
        </div>
      </fieldset>

      {error ? (
        <Callout tone="error">
          {error}
          {failedPatch ? <Button type="button" variant="secondary" onClick={retry}>Retry</Button> : null}
        </Callout>
      ) : null}
    </section>
  );
}
