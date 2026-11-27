import type { CSSProperties } from 'react';
import { cardImageOk, cardTypeName, effectivePictureMode, hasCard, isPictureProvider, WIDGET_NAMES, widgetHeight, widgetOpenUrl, widgetSrc, type PictureMode, type WidgetProvider } from '@curios/core/widgets';
import type { PictureWords } from './page-copy.js';
import { Pictures, type PublicPicture } from './Pictures.js';
import styles from './Bento.module.css';

export interface WidgetProps {
  provider: WidgetProvider;
  /** Null for Pictures and GIF, which have no player. */
  embedRef: string | null;
  label: string;
  /** The owner's pasted share link; the way through when the frame is blocked. */
  url: string;
  /** A card's title and cover (Spotify, Apple Music), fetched when the widget was saved; null falls back to the label and the service's mark. */
  title?: string | null;
  image?: string | null;
  /** The page's words for a card's type line and spoken name (page-copy); English when left out. */
  words?: { types: Record<string, string>; on: string; pictures?: PictureWords };
  /** Pictures and GIF: their mode, alt text and pictures (public URLs, in order). */
  pictureMode?: PictureMode | null;
  altText?: string | null;
  pictures?: PublicPicture[];
  /** False in the editor's preview: a cover over the frame, nothing to press. */
  interactive?: boolean;
  /** In a Bento tile: the player fills the tile, never shorter than its own height. */
  fill?: boolean;
}

/** Players that take a booking need forms; the rest never do. */
const TAKES_FORMS: WidgetProvider[] = ['CALCOM', 'CALENDLY'];
const ASPECT: Partial<Record<WidgetProvider, string>> = { YOUTUBE: '16 / 9', CANVA: '4 / 3' };

const ENGLISH_PICTURES: PictureWords = { open: '{alt}, open full screen', previous: 'Previous picture', next: 'Next picture', close: 'Close', viewer: 'Pictures', of: '{n} of {total}' };

const PLAY = 'M10 8.5v7l6-3.5z';

/** The service's mark when a card has no cover: a Spotify disc with its three arcs, an Apple Music note. */
function ServiceMark({ provider }: { provider: WidgetProvider }) {
  return provider === 'SPOTIFY' ? (
    <svg className={styles.cardMark} viewBox="0 0 24 24" aria-hidden="true" data-card-mark>
      <circle cx="12" cy="12" r="10" fill="currentColor" stroke="none" />
      <path d="M6.6 9.4c3.7-1.1 8.1-.7 11.3 1.2M7.2 12.6c3.1-.9 6.5-.6 9.3 1M7.9 15.5c2.5-.7 5-.4 7.2.8" fill="none" stroke="var(--pill)" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ) : (
    <svg className={styles.cardMark} viewBox="0 0 24 24" aria-hidden="true" data-card-mark>
      <path d="M9 18V6l10-2v12M9 18a3 3 0 1 1-3-3 3 3 0 0 1 3 3zM19 16a3 3 0 1 1-3-3 3 3 0 0 1 3 3z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Spotify and Apple Music draw our own card, never their player (which shows an ad on phones): one link that
 * opens the item in the service. Drawn like a link button, so it sits with the links in List and Bento.
 * Null when the stored ref is not one of ours; the caller then draws the plain fallback.
 */
function CardWidget({ provider, embedRef, label, title, image, words, interactive, fill }: Required<Pick<WidgetProps, 'interactive' | 'fill'>> & { embedRef: string } & Pick<WidgetProps, 'provider' | 'label' | 'title' | 'image' | 'words'>) {
  let href: string;
  try {
    href = widgetOpenUrl(provider, embedRef);
  } catch {
    return null;
  }
  const service = WIDGET_NAMES[provider];
  const english = cardTypeName(provider, embedRef);
  const type = words?.types[english] ?? english;
  const named = label.trim() !== '' && label !== service ? label : null;
  const shown = title ?? named ?? service;
  // The owner's label sits above the card, unless the card already says it.
  const showLabel = named !== null && shown !== named;
  const cover = cardImageOk(provider, image) ? image : null;
  const inner = (
    <span className={styles.cardIn}>
      <span className={styles.cardCover} data-card-cover>
        {cover ? <img src={cover} alt="" loading="lazy" referrerPolicy="no-referrer" width={56} height={56} /> : <ServiceMark provider={provider} />}
      </span>
      <span className={styles.cardText}>
        <span className={styles.cardTitle} data-card-title>
          {shown}
        </span>
        <span className={styles.cardType}>{type ? `${type} · ${service}` : service}</span>
      </span>
      <svg className={styles.cardPlay} viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="12" fill="currentColor" opacity="0.12" />
        <path d={PLAY} fill="currentColor" />
      </svg>
    </span>
  );
  return (
    <div className={fill ? `${styles.widget} ${styles.widgetCard} ${styles.widgetFill}` : `${styles.widget} ${styles.widgetCard}`} data-fill={fill || undefined}>
      {showLabel ? (
        <p className={styles.widgetLabel} data-widget-label>
          {label}
        </p>
      ) : null}
      {interactive ? (
        <a className={styles.card} href={href} rel="noopener" aria-label={`${shown}, ${type ? (words?.on ?? '{type} on {service}').replace('{type}', type).replace('{service}', service) : service}`} data-widget-card>
          {inner}
        </a>
      ) : (
        <span className={styles.card} data-widget-card>
          {inner}
        </span>
      )}
    </div>
  );
}

/** Server-safe: no hooks. One bad stored row (widgetSrc throws) draws the fallback only. */
export function Widget({ provider, embedRef, label, url, title = null, image = null, words, pictureMode = null, altText = null, pictures = [], interactive = true, fill = false }: WidgetProps) {
  if (isPictureProvider(provider)) {
    // No player: a gallery or a GIF. A widget with nothing uploaded draws nothing (the public read leaves it off anyway).
    if (pictures.length === 0) return null;
    const mode = effectivePictureMode(provider, pictures.length, pictureMode);
    const showCaption = label.trim() !== '' && label !== WIDGET_NAMES[provider];
    return (
      <div className={fill ? `${styles.widget} ${styles.widgetPictures}` : styles.widget} data-fill={fill || undefined}>
        {showCaption ? (
          <p className={styles.widgetLabel} data-widget-label>
            {label}
          </p>
        ) : null}
        <Pictures label={label} mode={mode} pictures={pictures} altText={altText} words={words?.pictures ?? ENGLISH_PICTURES} interactive={interactive} fill={fill} />
      </div>
    );
  }
  if (embedRef === null) return null;
  if (hasCard(provider)) {
    const card = CardWidget({ provider, embedRef, label, title, image, words, interactive, fill });
    if (card) return card;
  }
  const service = WIDGET_NAMES[provider];
  let src: string | null = null;
  let height = 0;
  try {
    src = widgetSrc(provider, embedRef);
    height = widgetHeight(provider, embedRef);
  } catch {
    src = null;
  }
  const showLabel = label.trim() !== '' && label !== service;
  // On the frame itself, so the box's padding is added to it: the player gets exactly widgetHeight.
  const frameStyle: CSSProperties = height > 0 ? (fill ? { minHeight: height } : { height }) : { aspectRatio: ASPECT[provider] ?? '16 / 9' };
  const sandbox = ['allow-scripts', 'allow-same-origin', 'allow-popups', 'allow-popups-to-escape-sandbox', ...(TAKES_FORMS.includes(provider) ? ['allow-forms'] : [])].join(' ');
  return (
    <div className={fill ? `${styles.widget} ${styles.widgetFill}` : styles.widget} data-fill={fill || undefined}>
      {showLabel ? (
        <p className={styles.widgetLabel} data-widget-label>
          {label}
        </p>
      ) : null}
      {src ? (
        <div className={styles.widgetBox} data-widget-box>
          <iframe
            className={styles.widgetFrame}
            data-widget-frame
            src={src}
            style={frameStyle}
            title={`${label}, ${service}`}
            loading="lazy"
            sandbox={sandbox}
            allow="encrypted-media; fullscreen; picture-in-picture; clipboard-write"
            referrerPolicy="strict-origin-when-cross-origin"
          />
          {interactive ? null : <span className={styles.widgetCover} data-widget-cover aria-hidden="true" />}
        </div>
      ) : null}
      {interactive && url.startsWith('https://') ? (
        <a className={styles.widgetOpen} href={url} rel="noopener">
          Open in {service}
        </a>
      ) : null}
    </div>
  );
}
