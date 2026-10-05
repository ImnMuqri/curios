'use client';

import { useEffect, useRef, useState } from 'react';
import { Button, Callout } from '@curios/ui';
import { ACCENT_PRESETS, HEADING_FONTS, isHexColor, PAGE_BACKGROUNDS, tintOf, type HeadingFont, type PageBackground, type PageStyle } from '@curios/core/bento';
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

// A hex string is not a name -- "Accent #2340c8" tells a screen-reader user
// nothing a sighted owner does not already get for free from the swatch's
// colour. One name per preset, in `ACCENT_PRESETS`' order; the hex still
// shows, as the swatch's `title`, for whoever wants it.
const ACCENT_NAMES: Record<string, string> = {
  '#2340c8': 'Biru',
  '#0c7a62': 'Hijau',
  '#6d3fb3': 'Purple',
  '#c2185b': 'Magenta',
  '#d8452f': 'Red',
  '#e08a1e': 'Amber',
  '#2d6a4f': 'Forest',
  '#191f2c': 'Ink',
};

/**
 * The background bands, named for an owner and drawn from the palette's own
 * tokens (never a hex here: the page's stylesheet owns the colours).
 */
const BANDS: Record<Exclude<PageBackground, 'CUSTOM'>, { name: string; swatch: string }> = {
  PAPER: { name: 'Paper', swatch: 'var(--soft-page)' },
  MUDA: { name: 'Pale blue', swatch: 'var(--biru-muda)' },
  KUNING: { name: 'Warm', swatch: 'color-mix(in oklch, var(--kuning) 20%, var(--paper))' },
  BIRU: { name: 'Cobalt', swatch: 'var(--biru)' },
  INK: { name: 'Dark', swatch: 'var(--ink)' },
};

/**
 * Background, style, accent and heading font. Each choice is a single click, so it saves
 * at once rather than on a debounce. A custom colour saves only once it is a
 * valid hex; text on it is made readable by the page, not by the owner.
 */
export function AppearanceEditor({
  background,
  backgroundColor,
  style,
  accentColor,
  headingFont,
  onChange,
  save,
}: {
  background: PageBackground;
  /** The owner's own background colour, kept even while a band is chosen. */
  backgroundColor: string | null;
  style: PageStyle;
  accentColor: string;
  headingFont: HeadingFont;
  onChange: (change: AppearancePatch) => void;
  save: (patch: AppearancePatch) => Promise<unknown>;
}) {
  const [custom, setCustom] = useState(accentColor);
  // A first Custom pick starts as a light tint of the accent, so it already belongs to the page.
  const [customBg, setCustomBg] = useState(backgroundColor ?? tintOf(accentColor, 0.18));
  const bgTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (bgTimer.current) clearTimeout(bgTimer.current);
  }, []);

  /**
   * The custom background: the preview follows every move of the picker at
   * once, and the save waits until the owner pauses, so dragging across the
   * picker is one save, not a hundred.
   */
  const chooseBackgroundColor = (value: string) => {
    setCustomBg(value);
    if (!isHexColor(value)) {
      setError('Type a colour as six-digit hex, like #eaf0ff.');
      setFailedPatch(null);
      return;
    }
    const patch: AppearancePatch = { background: 'CUSTOM', backgroundColor: value.toLowerCase() };
    setError('');
    onChange(patch);
    if (bgTimer.current) clearTimeout(bgTimer.current);
    bgTimer.current = setTimeout(() => attempt(patch), 400);
  };
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
        <legend>Background</legend>
        <div className={styles.bands}>
          {PAGE_BACKGROUNDS.filter((value) => value !== 'CUSTOM').map((value) => (
            <label key={value} className={styles.band} data-checked={background === value}>
              <input type="radio" name="background" checked={background === value} onChange={() => choose({ background: value })} />
              <span className={styles.bandDot} style={{ background: BANDS[value].swatch }} aria-hidden="true" />
              {BANDS[value].name}
            </label>
          ))}
          <label className={styles.band} data-checked={background === 'CUSTOM'}>
            <input
              type="radio"
              name="background"
              checked={background === 'CUSTOM'}
              onChange={() => chooseBackgroundColor(isHexColor(customBg) ? customBg : tintOf(accentColor, 0.18))}
            />
            <span className={`${styles.bandDot} ${styles.customDot}`} style={{ background: customBg }} aria-hidden="true" />
            Custom
          </label>
        </div>
        {background === 'CUSTOM' ? (
          <div className={styles.customBg}>
            <input
              type="color"
              aria-label="Pick a background colour"
              className={styles.colorWell}
              value={isHexColor(customBg) ? customBg : '#ffffff'}
              onChange={(event) => chooseBackgroundColor(event.target.value)}
            />
            <label className={styles.custom}>
              Hex
              <input value={customBg} aria-label="Background colour as hex" onChange={(event) => chooseBackgroundColor(event.target.value.trim())} />
            </label>
          </div>
        ) : null}
      </fieldset>

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
                setError('Type a colour as six-digit hex, like #2340c8.');
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
