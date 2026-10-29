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
 * The look, in the Profile tab's last two sections (v3 board): Colours (the
 * page background and the button colour as two rows of dots, the hex field
 * kept), then Button style and font (the two styles as cards, the six heading
 * fonts as a grid of tiles, each the owner's name in that font). Each choice
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
      <section className={ui.section} aria-labelledby="colours-title">
        <SectionHead id="colours-title" title="Colours" note="The page behind everything, and your first link and the send button." />
        <div className={styles.colourCols}>
          <div>
            <p className={styles.groupLabel} id="background-label">
              Page
            </p>
            {/* Each background as a dot of its own colour, worked out by the page's theme as visitors get it. */}
            <div className={styles.dots} role="group" aria-labelledby="background-label">
              {PAGE_BACKGROUNDS.map((value) => {
                const drawn = value === 'CUSTOM' && !look.backgroundColor ? 'PAPER' : value;
                return (
                  <button
                    key={value}
                    type="button"
                    className={styles.dot}
                    aria-pressed={background === value}
                    aria-label={BACKGROUND_NAMES[value]}
                    title={BACKGROUND_NAMES[value]}
                    onClick={() =>
                      value === 'CUSTOM'
                        ? chooseBackgroundColor(isHexColor(customBg) ? customBg : tintOf(accentColor, 0.18))
                        : background === value
                          ? undefined
                          : choose({ background: value })
                    }
                  >
                    <span className={`${bento.theme} ${styles.dotFill}`} {...themeAttrs({ ...look, background: drawn })} data-island="" aria-hidden="true" />
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
          </div>
          <div>
            <p className={styles.groupLabel} aria-hidden="true">
              Buttons
            </p>
            {/* The accent colours the first link and the send button, so the board calls this row "Buttons". */}
            <div className={styles.swatches} role="group" aria-label="Button colour">
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
          </div>
        </div>
      </section>

      <section className={ui.section} aria-labelledby="shape-title">
        <SectionHead id="shape-title" title="Button style and font" note="How your links look, and the font for your name." />
        <div className={styles.shapeFont}>
          <div>
            <p className={styles.groupLabel} aria-hidden="true">
              Buttons
            </p>
            <div className={styles.styleTiles} role="group" aria-label="Button style">
              {STYLES.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`${ui.tile} ${styles.styleTile}`}
                  aria-pressed={style === option.value}
                  onClick={() => (style === option.value ? undefined : choose({ style: option.value }))}
                >
                  <Tick />
                  <span className={styles.styleMini} data-style={option.value} style={{ '--accent': accentColor } as CSSProperties} aria-hidden="true">
                    <i />
                    <i />
                  </span>
                  <span className={ui.tileName}>
                    {option.name} <span>· {option.note}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className={styles.groupLabel} id="font-label">
              Heading font
            </p>
            {/* Six tiles, three across: the owner's name in each font, the font's name under it. */}
            <div className={styles.fonts} role="group" aria-labelledby="font-label">
              {HEADING_FONTS.map((font) => (
                <button
                  key={font}
                  type="button"
                  className={styles.fontTile}
                  aria-pressed={headingFont === font}
                  aria-label={FONT_NAMES[font]}
                  onClick={() => (headingFont === font ? undefined : choose({ headingFont: font }))}
                >
                  <b style={{ fontFamily: HEADING_FONT_VAR[font] }} aria-hidden="true">
                    {displayName || 'Your name'}
                  </b>
                  <span aria-hidden="true">{FONT_NAMES[font]}</span>
                </button>
              ))}
            </div>
          </div>
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
