import type { CSSProperties, ReactNode } from 'react';
import {
  arrangeTiles,
  linkKind,
  readableOn,
  type HeadingFont,
  type PageStyle,
  type TileSize,
} from '@curios/core/bento';
import { HEADING_FONT_VAR } from '../../lib/heading-fonts.js';
import { Avatar } from './Avatar.js';
import styles from './Bento.module.css';

export interface BentoPageProps {
  displayName: string;
  handle: string;
  bio: string | null;
  avatarUrl: string | null;
  links: { id: string; label: string; url: string; size: TileSize | null }[];
  style: PageStyle;
  accentColor: string;
  headingFont: HeadingFont;
  /** False in the editor's live preview: tiles become boxes that cannot navigate. */
  interactive?: boolean;
  /** The ask bar, on the public page. */
  children?: ReactNode;
}

/**
 * A My Curios page, for visitors and for the editor's preview alike -- one
 * renderer, so the preview cannot disagree with the page.
 *
 * Server-safe: no hooks. The accent and heading font arrive as inline custom
 * properties, because they are the owner's data, not the design system's; the
 * stylesheet only ever reads var(--accent) and var(--font-heading).
 */
export function BentoPage(props: BentoPageProps) {
  const { interactive = true } = props;
  const tiles = arrangeTiles(props.links);
  const vars = {
    '--accent': props.accentColor,
    '--font-heading': HEADING_FONT_VAR[props.headingFont],
  } as CSSProperties;

  return (
    <div className={styles.page} data-style={props.style} data-on-accent={readableOn(props.accentColor)} style={vars}>
      <header className={styles.head}>
        {props.avatarUrl ? <Avatar src={props.avatarUrl} name={props.displayName} /> : null}
        <div>
          <h1 className={styles.name}>{props.displayName}</h1>
          <p className={styles.handle}>curios.my/{props.handle}</p>
        </div>
      </header>
      {props.bio ? <p className={styles.bio}>{props.bio}</p> : null}

      {tiles.length > 0 ? (
        <div className={styles.grid} data-bento-grid>
          {tiles.map(({ link, size, tone }) => {
            const body = (
              <>
                <span className={styles.kind}>{linkKind(link.url)}</span>
                <span className={styles.label}>{link.label}</span>
              </>
            );
            return interactive ? (
              <a key={link.id} className={styles.tile} data-size={size} data-tone={tone} href={link.url} rel="noopener">
                {body}
              </a>
            ) : (
              <div key={link.id} className={styles.tile} data-size={size} data-tone={tone}>
                {body}
              </div>
            );
          })}
        </div>
      ) : null}

      {props.children}
    </div>
  );
}
