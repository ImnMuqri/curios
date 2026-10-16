'use client';

import { useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import type { MyCurios } from '@curios/db-read';
import type { HeadingFont, PageBackground, PageStyle, StockCover } from '@curios/core/bento';
import type { Socials } from '@curios/core/socials';
import { formatRinggit } from '@curios/core/store';
import { BentoPage } from '../../_bento/BentoPage.js';
import { PageHead } from '../_ui/page-head.js';
import panel from '../panel.module.css';
import { AppearanceEditor } from './appearance-editor.js';
import { CoverEditor } from './cover-editor.js';
import { LinksEditor, type LinkItem } from './links-editor.js';
import { ProfileEditor } from './profile-editor.js';
import { SaveStatus, useSaveStatus } from './save-status.js';
import { ShopSwitch } from './shop-switch.js';
import { SocialsEditor } from './socials-editor.js';
import styles from './curios.module.css';

export type AppearancePatch = Partial<{
  background: PageBackground;
  backgroundColor: string;
  style: PageStyle;
  accentColor: string;
  headingFont: HeadingFont;
  displayName: string;
  bio: string | null;
  socials: Socials;
}>;

// Function-typed properties, not method shorthand: several of these are handed
// to child components as bare values (`addLink={api.addLink}`), and TS method
// syntax carries an implicit `this` that `@typescript-eslint/unbound-method`
// rightly distrusts once detached from `api`.
export interface CuriosApi {
  addLink: (input: { label: string; url: string }) => Promise<LinkItem>;
  updateLink: (id: string, patch: Partial<{ label: string; url: string }>) => Promise<LinkItem>;
  removeLink: (id: string) => Promise<void>;
  reorder: (ids: string[]) => Promise<void>;
  /** Opens or closes the shop, which is what gives the page its Shop tab. */
  setShopOpen: (open: boolean) => Promise<void>;
  saveAppearance: (patch: AppearancePatch) => Promise<unknown>;
  /** Resolves to the new picture's URL. */
  uploadAvatar: (file: File) => Promise<string | null>;
  removeAvatar: () => Promise<void>;
  /** Each resolves to the new cover's key and URL. */
  chooseStockCover: (name: StockCover) => Promise<{ coverKey: string; coverUrl: string | null }>;
  uploadCover: (file: File) => Promise<{ coverKey: string; coverUrl: string | null }>;
  removeCover: () => Promise<void>;
}

export type EditorPage = MyCurios & {
  avatarUrl: string | null;
  coverUrl: string | null;
  /** The first few items for sale, for the preview's Shop tab. */
  shopItems: { name: string; priceCents: number | null; photoUrl: string | null }[];
};

const TABS = [
  { id: 'profile', label: 'Profile' },
  { id: 'links', label: 'Links' },
  { id: 'appearance', label: 'Appearance' },
] as const;
type Tab = (typeof TABS)[number]['id'];
type PreviewTab = 'links' | 'ask' | 'shop';

/** Each tracked, so the header's "Saving…" and "Saved" cover every save on the screen. */
function trackedApi(api: CuriosApi, track: ReturnType<typeof useSaveStatus>['track']): CuriosApi {
  return {
    addLink: (input) => track(api.addLink(input)),
    updateLink: (id, patch) => track(api.updateLink(id, patch)),
    removeLink: (id) => track(api.removeLink(id)),
    reorder: (ids) => track(api.reorder(ids)),
    setShopOpen: (open) => track(api.setShopOpen(open)),
    saveAppearance: (patch) => track(api.saveAppearance(patch)),
    uploadAvatar: (file) => track(api.uploadAvatar(file)),
    removeAvatar: () => track(api.removeAvatar()),
    chooseStockCover: (name) => track(api.chooseStockCover(name)),
    uploadCover: (file) => track(api.uploadCover(file)),
    removeCover: () => track(api.removeCover()),
  };
}

/**
 * My Curios: the owner's page, arranged. The header says whether everything
 * has saved; under it, three tabs of controls on the left and the live
 * preview on the right (below, under 1200px), rendered by the same BentoPage
 * visitors see. State is local and optimistic; each control saves its own
 * change at once, or as the owner pauses typing.
 *
 * Every panel stays mounted and is only hidden: the name, bio and social
 * fields autosave on a debounce, and unmounting a panel mid-typing would drop
 * the save that was about to happen.
 */
export function MyCuriosEditor({
  initial,
  api: rawApi,
  uploadsEnabled,
  publicUrl,
}: {
  initial: EditorPage;
  api: CuriosApi;
  uploadsEnabled: boolean;
  /** The page's full address, for the copy button. */
  publicUrl: string;
}) {
  const [page, setPage] = useState(initial);
  const update = (change: Partial<EditorPage>) => setPage((current) => ({ ...current, ...change }));
  const { state, track } = useSaveStatus();
  const api = useMemo(() => trackedApi(rawApi, track), [rawApi, track]);
  const [tab, setTab] = useState<Tab>('profile');
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [previewTab, setPreviewTab] = useState<PreviewTab>('links');
  const [copied, setCopied] = useState(false);

  const shopOpen = page.shopTab?.open ?? false;
  const previewTabs: PreviewTab[] = shopOpen ? ['links', 'ask', 'shop'] : ['links', 'ask'];
  const shownPreview: PreviewTab = previewTab === 'shop' && !shopOpen ? 'links' : previewTab;
  const tabIndex = TABS.findIndex((t) => t.id === tab);

  // A tab list's keys: left and right move between tabs and select, Home and End jump.
  function onTabKey(event: KeyboardEvent<HTMLButtonElement>) {
    const next =
      event.key === 'ArrowRight'
        ? (tabIndex + 1) % TABS.length
        : event.key === 'ArrowLeft'
          ? (tabIndex - 1 + TABS.length) % TABS.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? TABS.length - 1
              : null;
    if (next === null) return;
    event.preventDefault();
    const id = TABS[next]!.id;
    setTab(id);
    tabRefs.current[id]?.focus();
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // No clipboard (an insecure origin, a denied permission): the address is on screen to select.
    }
  }

  return (
    <>
      <PageHead title="My Curios" beside={<SaveStatus state={state} />}>
        <span className={styles.url}>
          curios.my/{page.handle}
          <button type="button" className={styles.iconButton} aria-label="Copy link" title={copied ? 'Copied' : 'Copy'} onClick={() => void copyLink()}>
            {copied ? (
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" className={styles.toolIcon}>
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" className={styles.toolIcon}>
                <rect x="8" y="8" width="12" height="12" rx="2" />
                <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
              </svg>
            )}
          </button>
          <span className={styles.srOnly} aria-live="polite">{copied ? 'Link copied' : ''}</span>
        </span>
        <a className={panel.primaryLink} href={`/${page.handle}`} target="_blank" rel="noreferrer">
          View page
        </a>
      </PageHead>

      <div className={styles.body}>
        <div className={styles.edit}>
          <div className={styles.tabs} role="tablist" aria-label="Edit" style={{ '--at': tabIndex } as CSSProperties}>
            {TABS.map((t) => (
              <button
                key={t.id}
                ref={(el) => {
                  tabRefs.current[t.id] = el;
                }}
                type="button"
                role="tab"
                id={`tab-${t.id}`}
                aria-selected={tab === t.id}
                aria-controls={`panel-${t.id}`}
                tabIndex={tab === t.id ? 0 : -1}
                className={styles.tab}
                onClick={() => setTab(t.id)}
                onKeyDown={onTabKey}
              >
                {t.label}
              </button>
            ))}
            <span className={styles.underline} aria-hidden="true" />
          </div>

          <div role="tabpanel" id="panel-profile" aria-labelledby="tab-profile" hidden={tab !== 'profile'} className={styles.panel}>
            <CoverEditor
              coverKey={page.coverKey}
              coverUrl={page.coverUrl}
              uploadsEnabled={uploadsEnabled}
              look={page}
              onCover={update}
              chooseStock={api.chooseStockCover}
              uploadCover={api.uploadCover}
              removeCover={api.removeCover}
            />
            <ProfileEditor
              displayName={page.displayName}
              bio={page.bio}
              onChange={update}
              save={api.saveAppearance}
              avatarUrl={page.avatarUrl}
              uploadsEnabled={uploadsEnabled}
              onAvatar={(url) => update({ avatarUrl: url })}
              uploadAvatar={api.uploadAvatar}
              removeAvatar={async () => {
                await api.removeAvatar();
                update({ avatarUrl: null });
              }}
            />
          </div>

          <div role="tabpanel" id="panel-links" aria-labelledby="tab-links" hidden={tab !== 'links'} className={styles.panel}>
            <SocialsEditor socials={page.socials} onChange={(socials) => update({ socials })} save={api.saveAppearance} />
            <LinksEditor
              links={page.links}
              onChange={(links) => update({ links })}
              addLink={api.addLink}
              updateLink={api.updateLink}
              removeLink={api.removeLink}
              reorder={api.reorder}
              shop={page.shop}
            />
            {page.shopTab ? (
              <ShopSwitch
                open={page.shopTab.open}
                itemCount={page.shopTab.itemCount}
                setOpen={api.setShopOpen}
                onOpen={(open) =>
                  setPage((current) => ({
                    ...current,
                    shopTab: current.shopTab ? { ...current.shopTab, open } : null,
                    // The tile sits after the links when the shop opens, which is where the API puts it.
                    shop: open ? { position: current.links.length, size: null, itemCount: current.shopTab?.itemCount ?? 0, photoKey: null } : null,
                  }))
                }
              />
            ) : null}
          </div>

          <div role="tabpanel" id="panel-appearance" aria-labelledby="tab-appearance" hidden={tab !== 'appearance'} className={styles.panel}>
            <AppearanceEditor
              displayName={page.displayName}
              background={page.background}
              backgroundColor={page.backgroundColor}
              style={page.style}
              accentColor={page.accentColor}
              headingFont={page.headingFont}
              onChange={update}
              save={api.saveAppearance}
            />
          </div>
        </div>

        <section className={styles.preview} aria-label="Live preview">
          <span className={styles.blobs} aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
          </span>
          <div className={styles.phone}>
            <div className={styles.screen}>
              <div className={styles.scroll}>
                <BentoPage
                  {...page}
                  shop={shopOpen ? { position: 0, size: null, label: '', caption: '', photoUrl: null } : null}
                  mode={shownPreview === 'ask' ? 'chat' : shownPreview === 'shop' ? 'shop' : undefined}
                  interactive={false}
                  nameAs="p"
                >
                  <PreviewTabBody tab={shownPreview} hasLinks={page.links.length > 0} items={page.shopItems} />
                </BentoPage>
              </div>
              <span className={styles.askBar} style={{ '--accent': page.accentColor } as CSSProperties} aria-hidden="true">
                Ask {page.displayName} anything
                <i>
                  <svg viewBox="0 0 24 24" width="13" height="13">
                    <path d="M12 19V5M5 12l7-7 7 7" />
                  </svg>
                </i>
              </span>
            </div>
          </div>
          <div className={styles.seg} role="tablist" aria-label="Preview tab" style={{ '--n': previewTabs.length, '--at': previewTabs.indexOf(shownPreview) } as CSSProperties}>
            <span className={styles.segThumb} aria-hidden="true" />
            {previewTabs.map((id) => (
              <button key={id} type="button" role="tab" aria-selected={shownPreview === id} onClick={() => setPreviewTab(id)}>
                {id === 'links' ? 'Links' : id === 'ask' ? 'Ask' : 'Shop'}
              </button>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}

/** What the preview shows under the tabs that BentoPage leaves to its caller. */
function PreviewTabBody({ tab, hasLinks, items }: { tab: PreviewTab; hasLinks: boolean; items: EditorPage['shopItems'] }) {
  if (tab === 'links') return hasLinks ? null : <span className={styles.previewEmpty}>Your links show here</span>;
  if (tab === 'ask') return <p className={styles.previewAsk}>What do you want to know?</p>;
  if (items.length === 0) return <span className={styles.previewEmpty}>Your items show here</span>;
  return (
    <span className={styles.previewShop}>
      {items.map((item) => (
        <span key={item.name}>
          {item.photoUrl ? <img src={item.photoUrl} alt="" /> : <i />}
          {item.name}
          {item.priceCents !== null ? <em>{formatRinggit(item.priceCents)}</em> : null}
        </span>
      ))}
    </span>
  );
}
