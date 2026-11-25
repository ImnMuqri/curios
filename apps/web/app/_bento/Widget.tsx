import type { CSSProperties } from 'react';
import { WIDGET_NAMES, widgetHeight, widgetSrc, type WidgetProvider } from '@curios/core/widgets';
import styles from './Bento.module.css';

export interface WidgetProps {
  provider: WidgetProvider;
  embedRef: string;
  label: string;
  /** The owner's pasted share link; the way through when the frame is blocked. */
  url: string;
  /** False in the editor's preview: a cover over the frame, nothing to press. */
  interactive?: boolean;
}

/** Players that take a booking need forms; the rest never do. */
const TAKES_FORMS: WidgetProvider[] = ['CALCOM', 'CALENDLY'];
const ASPECT: Partial<Record<WidgetProvider, string>> = { YOUTUBE: '16 / 9', CANVA: '4 / 3' };

/** Server-safe: no hooks. One bad stored row (widgetSrc throws) draws the fallback only. */
export function Widget({ provider, embedRef, label, url, interactive = true }: WidgetProps) {
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
  const frameStyle: CSSProperties = height > 0 ? { height } : { aspectRatio: ASPECT[provider] ?? '16 / 9' };
  const sandbox = ['allow-scripts', 'allow-same-origin', 'allow-popups', 'allow-popups-to-escape-sandbox', ...(TAKES_FORMS.includes(provider) ? ['allow-forms'] : [])].join(' ');
  return (
    <div className={styles.widget}>
      {showLabel ? (
        <p className={styles.widgetLabel} data-widget-label>
          {label}
        </p>
      ) : null}
      {src ? (
        <div className={styles.widgetBox} data-widget-box>
          <iframe
            className={styles.widgetFrame}
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
