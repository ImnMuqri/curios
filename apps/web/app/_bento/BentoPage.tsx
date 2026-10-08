import type { CSSProperties, ReactNode } from 'react';
import {
  arrangeTiles,
  isHexColor,
  linkKind,
  readableOn,
  type HeadingFont,
  type PageBackground,
  type PageStyle,
  type TileSize,
} from '@curios/core/bento';
import { HEADING_FONT_VAR } from '../../lib/heading-fonts.js';
import { Avatar } from './Avatar.js';
import { Cover } from './Cover.js';
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
  /**
   * The element the owner's name renders as. h1 on the page itself; the landing
   * page shows a demo page inside its own document, which already has its h1.
   */
  nameAs?: 'h1' | 'p';
  /**
   * Drawn already in chat mode -- bio and tiles folded away, room for a
   * conversation -- for a page shown mid-chat (the landing page's storm). The
   * public page leaves this out: ChatMode sets the same attribute at runtime.
   */
  mode?: 'chat';
  /** The page's background band. PAPER, the look every page had before there was a choice, when left out. */
  background?: PageBackground;
  /** The owner's own colour, used when `background` is CUSTOM. */
  backgroundColor?: string | null;
  /** The cover photo's URL (stock or uploaded), or null for none. */
  coverUrl?: string | null;
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
 *
 * `data-bento-page` is a stable hook for a client descendant to find this
 * root through `closest()` -- `Ask`/`ChatMode` toggle `data-mode="chat"` on
 * it directly by DOM mutation, since this component itself stays server-only
 * and takes no chat-mode prop or state. `data-foldaway` marks the block that
 * CSS collapses in that mode (Bento.module.css, keyed on the same
 * attribute); the client side additionally marks it `inert`/`aria-hidden`
 * while collapsed, which is why it is its own wrapper rather than two
 * separately-collapsing pieces.
 */
export function BentoPage(props: BentoPageProps) {
  const { interactive = true, nameAs: Name = 'h1' } = props;
  const tiles = arrangeTiles(props.links);
  // Custom only with a colour to show; otherwise the look every page had before.
  const custom = props.background === 'CUSTOM' && props.backgroundColor && isHexColor(props.backgroundColor) ? props.backgroundColor : null;
  const background = props.background === 'CUSTOM' ? (custom ? 'CUSTOM' : 'PAPER') : (props.background ?? 'PAPER');
  const vars = {
    '--accent': props.accentColor,
    '--font-heading': HEADING_FONT_VAR[props.headingFont],
    ...(custom ? { '--custom-bg': custom } : {}),
  } as CSSProperties;

  return (
    <div
      className={styles.page}
      data-bento-page
      data-style={props.style}
      data-bg={background}
      // Which text reads on the owner's colour: the same test the accent uses.
      data-bg-text={custom ? readableOn(custom) : undefined}
      data-cover={props.coverUrl ? 'yes' : 'no'}
      data-mode={props.mode}
      data-on-accent={readableOn(props.accentColor)}
      style={vars}
    >
      {props.coverUrl ? <Cover src={props.coverUrl} /> : null}
      <header className={styles.head}>
        {props.avatarUrl ? <Avatar src={props.avatarUrl} name={props.displayName} /> : null}
        <div>
          <Name className={styles.name}>{props.displayName}</Name>
          <p className={styles.handle}>curios.my/{props.handle}</p>
        </div>
      </header>

      <div className={styles.foldaway} data-foldaway>
        <div className={styles.foldawayInner}>
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
        </div>
      </div>

      {props.children}
    </div>
  );
}
