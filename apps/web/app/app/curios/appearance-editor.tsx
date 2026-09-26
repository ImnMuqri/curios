'use client';

import { useState } from 'react';
import { Callout } from '@curios/ui';
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

  const choose = (patch: AppearancePatch) => {
    setError('');
    onChange(patch);
    save(patch).catch(() => setError('That did not save. Try again.'));
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
            <label key={hex} className={styles.swatch} style={{ background: hex }} data-checked={accentColor === hex}>
              <input type="radio" name="accent" aria-label={`Accent ${hex}`} checked={accentColor === hex} onChange={() => { setCustom(hex); choose({ accentColor: hex }); }} />
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
              else setError('Type a colour as six-digit hex, like #0c7a62.');
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

      {error ? <Callout tone="error">{error}</Callout> : null}
    </section>
  );
}
