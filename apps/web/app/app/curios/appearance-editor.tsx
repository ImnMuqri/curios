'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Button, Callout } from '@curios/ui';
import { ACCENT_PRESETS, HEADING_FONTS, isHexColor, PAGE_BACKGROUNDS, readableOn, tintOf, type HeadingFont, type PageBackground, type PageStyle } from '@curios/core/bento';
import { HEADING_FONT_VAR } from '../../../lib/heading-fonts.js';
import { themeAttrs } from '../../_bento/BentoPage.js';
import bento from '../../_bento/Bento.module.css';
import type { AppearancePatch as FullPatch } from './my-curios.js';

/** What this tab changes: the look, never the socials (the Links tab's). */
type AppearancePatch = Omit<FullPatch, 'socials'>;
import { SectionHead } from '../_ui/section-head.js';
import ui from '../_ui/editor.module.css';
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
// nothing a sighted owner does not already get from the swatch's colour.
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

const BACKGROUND_NAMES: Record<PageBackground, string> = {
  PAPER: 'Paper',
  MUDA: 'Pale blue',
  KUNING: 'Warm',
  BIRU: 'Biru',
  INK: 'Dark',
  CUSTOM: 'Custom',
};

const STYLES: { value: PageStyle; name: string; note: string }[] = [
  { value: 'SOFT', name: 'Soft', note: 'Light pills, gentle edges' },
  { value: 'CONTRAST', name: 'High contrast', note: 'Solid pills, bold edges' },
];

function Tick() {
  return (
    <span className={ui.tick} aria-hidden="true">
      <svg viewBox="0 0 24 24" width="12" height="12">
        <path d="M5 12.5l4.5 4.5L19 7.5" />
      </svg>
    </span>
  );
}

/**
 * Style, background, accent and heading font, each drawn as what it does: a
 * small page in each background, the owner's name in each font. Each choice
 * is a single click, so it saves at once rather than on a debounce. A typed
 * colour saves only once it is a valid hex; text on it is made readable by
 * the page, not by the owner.
 */
export function AppearanceEditor({
  displayName,
  background,
  backgroundColor,
  style,
  accentColor,
  headingFont,
  onChange,
  save,
}: {
  displayName: string;
  background: PageBackground;
  /** The owner's own background colour, kept even while a band is chosen. */
  backgroundColor: string | null;
  style: PageStyle;
  accentColor: string;
  headingFont: HeadingFont;
  onChange: (change: AppearancePatch) => void;
  save: (patch: AppearancePatch) => Promise<unknown>;
}) {
  const [hex, setHex] = useState(accentColor.replace(/^#/, ''));
  // A first Custom pick starts as a light tint of the accent, so it already belongs to the page.
  const [customBg, setCustomBg] = useState(backgroundColor ?? tintOf(accentColor, 0.18));
  const bgTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (bgTimer.current) clearTimeout(bgTimer.current);
    },
    [],
  );
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

  const look = { accentColor, headingFont, backgroundColor: isHexColor(customBg) ? customBg : null };

  return (
    <>
      <section className={ui.section} aria-labelledby="style-title">
        <SectionHead id="style-title" icon="style" tone="biru" title="Style" note="How your buttons look" />
        <div className={styles.styleTiles} role="group" aria-labelledby="style-title">
          {STYLES.map((option) => (
            <button
              key={option.value}
              type="button"
              className={ui.tile}
              aria-pressed={style === option.value}
              onClick={() => (style === option.value ? undefined : choose({ style: option.value }))}
            >
              <Tick />
              <span className={styles.styleMini} data-style={option.value} style={{ '--accent': accentColor } as CSSProperties} aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              <span className={ui.tileName}>
                {option.name} <span>· {option.note}</span>
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className={ui.section} aria-labelledby="background-title">
        <SectionHead id="background-title" icon="layers" tone="hijau" title="Background" note="Behind your whole page" />
        <div className={styles.backgroundTiles} role="group" aria-labelledby="background-title">
          {PAGE_BACKGROUNDS.map((value) => {
            const drawn = value === 'CUSTOM' && !look.backgroundColor ? 'PAPER' : value;
            return (
              <button
                key={value}
                type="button"
                className={`${ui.tile} ${styles.backgroundTile}`}
                aria-pressed={background === value}
                onClick={() =>
                  value === 'CUSTOM'
                    ? chooseBackgroundColor(isHexColor(customBg) ? customBg : tintOf(accentColor, 0.18))
                    : background === value
                      ? undefined
                      : choose({ background: value })
                }
              >
                <Tick />
                <span className={`${bento.theme} ${styles.backgroundMini}`} {...themeAttrs({ ...look, background: drawn })} aria-hidden="true">
                  <b />
                  <i data-accent />
                  <i />
                  <i />
                </span>
                <span className={ui.tileName}>{BACKGROUND_NAMES[value]}</span>
              </button>
            );
          })}
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
            <span className={styles.hex}>
              <input aria-label="Background colour as hex" value={customBg} onChange={(event) => chooseBackgroundColor(event.target.value.trim())} />
            </span>
          </div>
        ) : null}
      </section>

      <section className={ui.section} aria-labelledby="accent-title">
        <SectionHead id="accent-title" icon="palette" tone="rose" title="Accent colour" note="Your first link and the send button" />
        <div className={styles.swatches} role="group" aria-labelledby="accent-title">
          {/* The owner's own colour joins the row, chosen, so the row always shows what the page wears. */}
          {[...ACCENT_PRESETS, ...((ACCENT_PRESETS as readonly string[]).includes(accentColor) ? [] : [accentColor])].map((preset) => (
            <button
              key={preset}
              type="button"
              className={styles.swatch}
              style={{ '--swatch': preset } as CSSProperties}
              data-on={readableOn(preset)}
              aria-label={ACCENT_NAMES[preset] ?? 'Your colour'}
              title={preset}
              aria-pressed={accentColor === preset}
              onClick={() => {
                setHex(preset.slice(1));
                if (accentColor !== preset) choose({ accentColor: preset });
              }}
            >
              <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
            </button>
          ))}
          <span className={styles.hex}>
            #
            <input
              aria-label="Accent colour as hex"
              value={hex}
              maxLength={6}
              onChange={(event) => {
                const value = event.target.value.replace(/[^0-9a-f]/gi, '').slice(0, 6);
                setHex(value);
                if (isHexColor(`#${value}`)) choose({ accentColor: `#${value.toLowerCase()}` });
                else {
                  // Not a failed save -- nothing was sent -- so there is
                  // nothing for a Retry button here to resend.
                  setError('Type a colour as six-digit hex, like 2340c8.');
                  setFailedPatch(null);
                }
              }}
            />
          </span>
        </div>
      </section>

      <section className={ui.section} aria-labelledby="font-title">
        <SectionHead id="font-title" icon="type" tone="amber" title="Heading font" note="Used for your name" />
        <div className={styles.fonts} role="group" aria-labelledby="font-title">
          {HEADING_FONTS.map((font) => (
            <button
              key={font}
              type="button"
              className={styles.fontRow}
              aria-pressed={headingFont === font}
              aria-label={FONT_NAMES[font]}
              onClick={() => (headingFont === font ? undefined : choose({ headingFont: font }))}
            >
              <b style={{ fontFamily: HEADING_FONT_VAR[font] }} aria-hidden="true">
                {displayName || 'Your name'}
              </b>
              <span aria-hidden="true">{FONT_NAMES[font]}</span>
              <span className={styles.radio} aria-hidden="true">
                <svg viewBox="0 0 24 24" width="11" height="11">
                  <path d="M5 12.5l4.5 4.5L19 7.5" />
                </svg>
              </span>
            </button>
          ))}
        </div>
      </section>

      {error ? (
        <Callout tone="error">
          {error}
          {failedPatch ? (
            <Button type="button" variant="secondary" onClick={() => attempt(failedPatch)}>
              Retry
            </Button>
          ) : null}
        </Callout>
      ) : null}
    </>
  );
}
