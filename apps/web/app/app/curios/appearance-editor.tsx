'use client';

import { useState, type CSSProperties } from 'react';
import { Button, Callout } from '@curios/ui';
import { ACCENT_PRESETS, HEADING_FONTS, isHexColor, PAGE_BACKGROUNDS, readableOn, tintOf, type HeadingFont, type PageBackground, type PageStyle } from '@curios/core/bento';
import { HEADING_FONT_VAR } from '../../../lib/heading-fonts.js';
import { themeAttrs } from '../../_bento/BentoPage.js';
import bento from '../../_bento/Bento.module.css';
import type { AppearancePatch as FullPatch } from './my-curios.js';

/** What this tab changes: the look, never the socials (the Links tab's). */
type AppearancePatch = Omit<FullPatch, 'socials'>;
import { CustomColour, COLOUR_ERROR } from './custom-colour.js';
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
  '#2340c8': 'Cobalt',
  '#0c7a62': 'Jade',
  '#6d3fb3': 'Violet',
  '#c2185b': 'Pink',
  '#d8452f': 'Coral',
  '#e08a1e': 'Amber',
  '#2d6a4f': 'Forest',
  '#191f2c': 'Ink',
};

const BACKGROUND_NAMES: Record<PageBackground, string> = {
  PAPER: 'Paper',
  MUDA: 'Mist',
  KUNING: 'Cream',
  BIRU: 'Cobalt',
  INK: 'Ink',
  CUSTOM: 'Custom',
};

/** The second colour's choices: the accent row's colours, with white for a dark page. */
const SECONDARY_PRESETS = [...ACCENT_PRESETS, '#ffffff'] as const;
const SECONDARY_NAMES: Record<string, string> = { '#ffffff': 'White' };

const STYLES: { value: PageStyle; name: string; note: string }[] = [
  { value: 'SOFT', name: 'Soft', note: 'Light pills, gentle edges' },
  { value: 'CONTRAST', name: 'High contrast', note: 'Solid pills, bold edges' },
  { value: 'CHUNKY', name: 'Chunky', note: 'Outlined, with a hard shadow' },
  { value: 'OUTLINE', name: 'Outline', note: 'See-through, coloured edge' },
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
 * kept), then Buttons and font (the two styles as cards, the six heading
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
  secondaryColor = null,
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
  /** The buttons' edge and shadow; null is the page's text colour. */
  secondaryColor?: string | null;
  headingFont: HeadingFont;
  onChange: (change: AppearancePatch) => void;
  save: (patch: AppearancePatch) => Promise<unknown>;
}) {
  // A first Custom pick starts as a light tint of the accent, so it already belongs to the page.
  const [customBg, setCustomBg] = useState(backgroundColor ?? tintOf(accentColor, 0.18));
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

  /** The custom background, chosen as a whole colour: the preview and the save both follow at once, as the button colour does. */
  const chooseBackgroundColor = (value: string) => {
    setCustomBg(value.toLowerCase());
    if (background === 'CUSTOM' && backgroundColor?.toLowerCase() === value.toLowerCase()) return;
    choose({ background: 'CUSTOM', backgroundColor: value.toLowerCase() });
  };
  /** Not a failed save -- nothing was sent -- so there is nothing for a Retry button to resend. */
  const wrongColour = () => {
    setError(COLOUR_ERROR);
    setFailedPatch(null);
  };

  const look = { accentColor, headingFont, backgroundColor: isHexColor(customBg) ? customBg : null };

  return (
    <>
      <section className={`${ui.section} ${ui.sectionRow}`} aria-labelledby="colours-title">
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
            {/* Always there, like the button colour's: typing a colour picks Custom. */}
            <div className={styles.customBg}>
              <CustomColour
                value={isHexColor(customBg) ? customBg : tintOf(accentColor, 0.18)}
                label="Background colour as hex"
                onColour={chooseBackgroundColor}
                onInvalid={wrongColour}
              />
            </div>
          </div>
          <div>
            <p className={styles.groupLabel} aria-hidden="true">
              Buttons · primary
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
                  onClick={() => (accentColor !== preset ? choose({ accentColor: preset }) : undefined)}
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                    <path d="M5 12.5l4.5 4.5L19 7.5" />
                  </svg>
                </button>
              ))}
              <CustomColour
                value={accentColor}
                label="Accent colour as hex"
                onColour={(hex) => (hex !== accentColor ? choose({ accentColor: hex }) : undefined)}
                onInvalid={wrongColour}
              />
            </div>
            <p className={`${styles.groupLabel} ${styles.groupLabelNext}`} aria-hidden="true">
              Buttons · secondary
              <small>The edge and shadow</small>
            </p>
            {/* Auto is the page's text colour, the look every page had before there was a choice. */}
            <div className={styles.swatches} role="group" aria-label="Button edge colour">
              <button
                type="button"
                className={styles.swatchAuto}
                aria-pressed={secondaryColor === null}
                title="The page's text colour"
                onClick={() => (secondaryColor === null ? undefined : choose({ secondaryColor: null }))}
              >
                Auto
              </button>
              {[...SECONDARY_PRESETS, ...(secondaryColor === null || (SECONDARY_PRESETS as readonly string[]).includes(secondaryColor) ? [] : [secondaryColor])].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  className={styles.swatch}
                  style={{ '--swatch': preset } as CSSProperties}
                  data-on={readableOn(preset)}
                  aria-label={`${ACCENT_NAMES[preset] ?? SECONDARY_NAMES[preset] ?? 'Your colour'} edge`}
                  title={preset}
                  aria-pressed={secondaryColor === preset}
                  onClick={() => (secondaryColor !== preset ? choose({ secondaryColor: preset }) : undefined)}
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                    <path d="M5 12.5l4.5 4.5L19 7.5" />
                  </svg>
                </button>
              ))}
              <CustomColour
                value={secondaryColor ?? ''}
                label="Button edge colour as hex"
                onColour={(hex) => (hex !== secondaryColor ? choose({ secondaryColor: hex }) : undefined)}
                onInvalid={wrongColour}
              />
            </div>
          </div>
        </div>
      </section>

      <section className={`${ui.section} ${ui.sectionRow}`} aria-labelledby="shape-title">
        <SectionHead id="shape-title" title="Buttons and font" note="How your links look, and the font for your name." />
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
                  <span className={styles.styleMini} data-style={option.value} style={{ '--accent': accentColor, ...(secondaryColor ? { '--btn-second': secondaryColor } : {}) } as CSSProperties} aria-hidden="true">
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
