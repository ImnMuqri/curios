import type { CSSProperties, ReactNode } from 'react';
import {
  isHexColor,
  readableOn,
  type HeadingFont,
  type PageBackground,
  type PageStyle,
  type TileSize,
} from '@curios/core/bento';
import { socialUrl, type SocialKind } from '@curios/core/socials';
import { HEADING_FONT_VAR } from '../../lib/heading-fonts.js';
import { Avatar } from './Avatar.js';
import { Cover } from './Cover.js';
import { pageCopy } from './page-copy.js';
import styles from './Bento.module.css';

export interface BentoPageProps {
  displayName: string;
  handle: string;
  bio: string | null;
  avatarUrl: string | null;
  /** In the order visitors see them. `size` is kept on the rows but no longer drawn: every link is a pill. */
  links: { id: string; label: string; url: string; size: TileSize | null }[];
  style: PageStyle;
  accentColor: string;
  headingFont: HeadingFont;
  /** False in the editor's live preview: links and tabs become boxes that cannot navigate. */
  interactive?: boolean;
  /**
   * The element the owner's name renders as. h1 on the page itself; the landing
   * page shows a demo page inside its own document, which already has its h1.
   */
  nameAs?: 'h1' | 'p';
  /**
   * Present when the shop is open: the shop is the first link on the Links
   * tab, a pill in the accent with up to three overlapping product photos (an
   * initial stands in for a missing one), `label`, and the `caption` under it
   * ("3 items · next pickup Sat 17 Oct"). There is no Shop tab.
   */
  shop?: { label: string; caption: string; photos: { url: string | null; name: string }[] } | null;
  /**
   * Which tab the page is drawn on. Left out, it is Links; the public page's
   * Ask flips to chat at runtime by setting the same attribute (ChatMode).
   * `'chat'` draws a page already mid-conversation (the landing's demos);
   * `'shop'` is /handle/shop, drawn on no tab. Either way the links and the
   * FAQ fold away.
   */
  mode?: 'chat' | 'shop';
  /** The page's background band. PAPER, the look every page had before there was a choice, when left out. */
  background?: PageBackground;
  /** The owner's own colour, used when `background` is CUSTOM. */
  backgroundColor?: string | null;
  /** The cover photo's URL (stock or uploaded), or null for none. */
  coverUrl?: string | null;
  /** The page's language, for its own words (tabs, FAQ, footer). Anything but 'ms' reads English. */
  language?: string;
  /** The most asked answered questions, opened in place, and how many there are in all. */
  faq?: { entries: { slug: string; question: string; answer: string }[]; total: number } | null;
  /**
   * The page on its own, at a URL: a 460px column over a darker field of its
   * own colour on a wide screen. Left out wherever the page sits inside
   * something else (the editor's phone, the landing's demos).
   */
  stage?: boolean;
  /** Social profiles, shown as icons under the handle. */
  socials?: { kind: SocialKind; value: string }[];
  /** The basket bar: held at the foot of the Links tab, hidden on Ask. */
  basketBar?: ReactNode;
  /** The ask bar, on the public page; the shop's shelf on /handle/shop. */
  children?: ReactNode;
}

/** One stroke icon per profile kind, from the boards. */
const SOCIAL_ICON: Record<SocialKind, { label: string; d: string }> = {
  instagram: { label: 'Instagram', d: 'M7 3h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM17.5 6.5h.01' },
  whatsapp: { label: 'WhatsApp', d: 'M4 20l1.4-4.2A8 8 0 1 1 8.6 19z' },
  tiktok: { label: 'TikTok', d: 'M14 3v11.5a3.5 3.5 0 1 1-3.5-3.5M14 3c.6 2.6 2.4 4 5 4' },
  email: { label: 'Email', d: 'M3 5h18v14H3zM3 7l9 6 9-6' },
  facebook: { label: 'Facebook', d: 'M14 8h3V4h-3a4 4 0 0 0-4 4v3H7v4h3v6h4v-6h3l1-4h-4V8z' },
  youtube: { label: 'YouTube', d: 'M3 8a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3zM10 9l5 3-5 3z' },
};

/** How many FAQ entries open in place under the links; the rest are a tap away. */
export const FAQ_SHOWN = 3;

/**
 * The attributes that carry a page's look -- its band, the text that reads on
 * it, its accent and heading font -- for any element that should wear it. The
 * page itself, its stage, and `PageTheme` (the FAQ pages) all spread these.
 */
export function themeAttrs(theme: {
  accentColor: string;
  headingFont: HeadingFont;
  background?: PageBackground;
  backgroundColor?: string | null;
}) {
  // Custom only with a colour to show; otherwise the look every page had before.
  const custom = theme.background === 'CUSTOM' && theme.backgroundColor && isHexColor(theme.backgroundColor) ? theme.backgroundColor : null;
  const background = theme.background === 'CUSTOM' ? (custom ? 'CUSTOM' : 'PAPER') : (theme.background ?? 'PAPER');
  return {
    'data-bg': background,
    // Which text reads on the owner's colour: the same test the accent uses.
    'data-bg-text': custom ? readableOn(custom) : undefined,
    'data-on-accent': readableOn(theme.accentColor),
    style: {
      '--accent': theme.accentColor,
      '--font-heading': HEADING_FONT_VAR[theme.headingFont],
      ...(custom ? { '--custom-bg': custom } : {}),
    } as CSSProperties,
  };
}

/** A page's colours and heading font as custom properties, with no page layout: for its FAQ pages. */
export function PageTheme({ theme, className, children }: { theme: Parameters<typeof themeAttrs>[0]; className?: string; children: ReactNode }) {
  return (
    <div className={`${styles.theme} ${className ?? ''}`} {...themeAttrs(theme)}>
      {children}
    </div>
  );
}

/** The shop pill's inside, from the Public board: the photos overlap, then the words, then a chevron. */
function ShopPill({ shop }: { shop: NonNullable<BentoPageProps['shop']> }) {
  return (
    <span className={styles.shopIn}>
      <span className={styles.shopPhotos} aria-hidden="true">
        {shop.photos.map((photo, index) => (
          <span key={index} className={styles.shopPhoto}>
            {photo.name.trim().charAt(0).toUpperCase()}
            {photo.url ? <img src={photo.url} alt="" /> : null}
          </span>
        ))}
      </span>
      <span className={styles.shopText}>
        <b>{shop.label}</b>
        <small>{shop.caption}</small>
      </span>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M9 6l6 6-6 6" />
      </svg>
    </span>
  );
}

/**
 * A Curios page, for visitors and for the editor's preview alike -- one
 * renderer, so the preview cannot disagree with the page. (Named for the bento
 * grid it used to draw; since the design handoff it is a centred profile, a
 * row of tabs and a column of pill links.)
 *
 * Server-safe: no hooks. The accent and heading font arrive as inline custom
 * properties, because they are the owner's data, not the design system's; the
 * stylesheet only ever reads var(--accent) and var(--font-heading).
 *
 * `data-bento-page` is a stable hook for a client descendant to find this
 * root through `closest()`: `Ask`/`ChatMode` toggle `data-mode="chat"` on it
 * and move `aria-current` between the `[data-tab]` links, since this component
 * stays server-only and holds no state. `data-foldaway` marks the block that
 * CSS collapses on the Ask and Shop tabs; the client side also marks it
 * `inert`/`aria-hidden` while it is collapsed.
 */
export function BentoPage(props: BentoPageProps) {
  const { interactive = true, nameAs: Name = 'h1' } = props;
  const copy = pageCopy(props.language);
  const theme = themeAttrs(props);

  const home = `/${props.handle}`;
  const tabs: { id: 'links' | 'ask'; label: string; href: string; current: boolean }[] = [
    { id: 'links', label: copy.links, href: home, current: props.mode === undefined },
    { id: 'ask', label: copy.ask, href: `${home}#ask`, current: props.mode === 'chat' },
  ];
  const faqHref = `${home}/faq`;

  const page = (
    <div
      className={styles.page}
      data-bento-page
      data-style={props.style}
      data-cover={props.coverUrl ? 'yes' : 'no'}
      data-mode={props.mode}
      {...theme}
    >
      {props.coverUrl ? <Cover src={props.coverUrl} /> : null}
      <header className={styles.head}>
        {props.avatarUrl ? <Avatar src={props.avatarUrl} name={props.displayName} /> : null}
        <Name className={styles.name}>{props.displayName}</Name>
        <p className={styles.handle}>curios.my/{props.handle}</p>
        {props.socials && props.socials.length > 0 ? (
          <ul className={styles.socials} aria-label="Profiles">
            {props.socials.map(({ kind, value }) => (
              <li key={kind}>
                {interactive ? (
                  <a href={socialUrl(kind, value)} rel="noopener" aria-label={SOCIAL_ICON[kind].label}>
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d={SOCIAL_ICON[kind].d} />
                    </svg>
                  </a>
                ) : (
                  <span aria-label={SOCIAL_ICON[kind].label}>
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d={SOCIAL_ICON[kind].d} />
                    </svg>
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : null}
        {props.bio ? <p className={styles.bio}>{props.bio}</p> : null}
        <nav className={styles.tabs} aria-label={copy.sections} data-tabs style={{ '--tabs': tabs.length } as CSSProperties}>
          {tabs.map((tab) =>
            interactive ? (
              <a key={tab.id} className={styles.tab} href={tab.href} data-tab={tab.id} aria-current={tab.current ? 'page' : undefined}>
                {tab.label}
              </a>
            ) : (
              <span key={tab.id} className={styles.tab} data-tab={tab.id} aria-current={tab.current ? 'page' : undefined}>
                {tab.label}
              </span>
            ),
          )}
        </nav>
      </header>

      <div className={styles.foldaway} data-foldaway>
        <div className={styles.foldawayInner}>
          {props.links.length > 0 || props.shop ? (
            <ul className={styles.links} role="list" data-shop={props.shop ? 'yes' : undefined}>
              {props.shop ? (
                <li>
                  {interactive ? (
                    <a className={styles.shopLink} href={`${home}/shop`}>
                      <ShopPill shop={props.shop} />
                    </a>
                  ) : (
                    <span className={styles.shopLink}>
                      <ShopPill shop={props.shop} />
                    </span>
                  )}
                </li>
              ) : null}
              {props.links.map((link) => (
                <li key={link.id}>
                  {interactive ? (
                    <a className={styles.link} href={link.url} rel="noopener">
                      <span>{link.label}</span>
                    </a>
                  ) : (
                    <span className={styles.link}>
                      <span>{link.label}</span>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : null}

          {props.faq && props.faq.entries.length > 0 ? (
            <section className={styles.faq} aria-labelledby="often-ask">
              <h2 id="often-ask" className={styles.faqTitle}>
                {copy.oftenAsk}
                <a href={faqHref}>{copy.seeAll(props.faq.total)}</a>
              </h2>
              {props.faq.entries.slice(0, FAQ_SHOWN).map((entry, index) => (
                // <details>, so the accordion works before (and without) JavaScript.
                <details key={entry.slug} className={styles.faqItem} open={index === 0}>
                  <summary>
                    {entry.question}
                    <span className={styles.faqSign} aria-hidden="true" />
                  </summary>
                  <p>{entry.answer}</p>
                </details>
              ))}
            </section>
          ) : null}

          {interactive ? (
            <p className={styles.foot}>
              {props.faq && props.faq.entries.length > 0 ? (
                <>
                  <a href={faqHref}>{copy.questions}</a> ·{' '}
                </>
              ) : null}
              <a href="/">{copy.madeWith}</a>
            </p>
          ) : null}
        </div>
      </div>

      {props.basketBar ? <div className={styles.basketSlot}>{props.basketBar}</div> : null}

      {props.children}
    </div>
  );

  if (!props.stage) return page;
  return (
    <div className={styles.stage} {...theme}>
      {props.coverUrl ? (
        <div className={styles.backdrop} aria-hidden="true">
          <img src={props.coverUrl} alt="" />
        </div>
      ) : null}
      {page}
    </div>
  );
}
