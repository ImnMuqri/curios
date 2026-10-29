'use client';

import { useMemo, useState, type CSSProperties } from 'react';
import type { MyCurios } from '@curios/db-read';
import type { HeadingFont, PageBackground, PageStyle, StockCover } from '@curios/core/bento';
import type { Socials } from '@curios/core/socials';
import { Thinking } from '@curios/ui';
import { shopCopy } from '../../[handle]/shop/copy.js';
import { BentoPage, type BentoPageProps } from '../../_bento/BentoPage.js';
import { PageHead } from '../_ui/page-head.js';
import { PageReply } from '../_ui/page-reply.js';
import { VisitorQuestion } from '../_ui/visitor-question.js';
import { PreviewFrame } from '../_ui/preview-frame.js';
import { SaveStatus, useSaveStatus } from '../_ui/save-status.js';
import { PillTabs } from '../_ui/pill-tabs.js';
import panel from '../panel.module.css';
import { AppearanceEditor } from './appearance-editor.js';
import { CoverEditor } from './cover-editor.js';
import { LinksEditor, type LinkItem } from './links-editor.js';
import { ProfileEditor } from './profile-editor.js';
import { ShopSwitch } from './shop-switch.js';
import { SocialsEditor } from './socials-editor.js';
import ui from '../_ui/editor.module.css';
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
  /** Opens or closes the shop, which is what gives the page its Shop link. */
  setShopOpen: (open: boolean) => Promise<void>;
  saveAppearance: (patch: AppearancePatch) => Promise<unknown>;
  /** Resolves to the new picture's URL. */
  uploadAvatar: (file: File) => Promise<string | null>;
  removeAvatar: () => Promise<void>;
  /** Each resolves to the new cover's key and URL. */
  chooseStockCover: (name: StockCover) => Promise<{ coverKey: string; coverUrl: string | null }>;
  uploadCover: (file: File) => Promise<{ coverKey: string; coverUrl: string | null }>;
  removeCover: () => Promise<void>;
  /** The preview's Ask tab: what the page really says, through the owner's tester. */
  askPage: (question: string) => Promise<{ reply: string }>;
}

export type EditorPage = MyCurios & {
  avatarUrl: string | null;
  coverUrl: string | null;
  /** The first few items for sale, for the preview's shop pill. */
  shopItems: { name: string; priceCents: number | null; photoUrl: string | null }[];
  /** The question the preview's Ask tab offers: the most asked, or a starter. */
  previewQuestion: string;
  /** The page's most asked answered questions, for "People often ask" on the Links tab. */
  faq?: BentoPageProps['faq'];
};

const TABS = [
  { id: 'profile', label: 'Profile' },
  { id: 'links', label: 'Links' },
  { id: 'appearance', label: 'Appearance' },
] as const;
type Tab = (typeof TABS)[number]['id'];
type PreviewTab = 'links' | 'ask';

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
    // A question, not a save: the header's status is not its business.
    askPage: (question) => api.askPage(question),
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
  const [previewTab, setPreviewTab] = useState<PreviewTab>('links');
  const [copied, setCopied] = useState(false);

  const shopOpen = page.shopTab?.open ?? false;
  const previewTabs: PreviewTab[] = ['links', 'ask'];
  const shownPreview = previewTab;

  // The shop pill as visitors see it, minus the pickup day (that needs the shop's terms the editor does not carry).
  const previewPill = shopOpen && (page.shopTab?.itemCount ?? 0) > 0
    ? {
        label: 'Shop',
        caption: shopCopy(page.language).itemCount(page.shopTab?.itemCount ?? 0),
        photos: page.shopItems.slice(0, 3).map((item) => ({ name: item.name, url: item.photoUrl })),
      }
    : null;

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
        <span className={ui.url}>
          curios.my/{page.handle}
          <button type="button" className={ui.iconButton} aria-label="Copy link" title={copied ? 'Copied' : 'Copy'} onClick={() => void copyLink()}>
            {copied ? (
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" className={ui.toolIcon}>
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" className={ui.toolIcon}>
                <rect x="8" y="8" width="12" height="12" rx="2" />
                <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
              </svg>
            )}
          </button>
          <span className={ui.srOnly} aria-live="polite">{copied ? 'Link copied' : ''}</span>
        </span>
        <a className={panel.primaryLink} href={`/${page.handle}`} target="_blank" rel="noreferrer">
          View page
        </a>
      </PageHead>

      <div className={ui.body}>
        <div className={ui.edit}>
          <PillTabs label="Edit" tabs={TABS} selected={tab} onSelect={setTab} />

          <div role="tabpanel" id="panel-profile" aria-labelledby="tab-profile" hidden={tab !== 'profile'} className={ui.panel}>
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

          <div role="tabpanel" id="panel-links" aria-labelledby="tab-links" hidden={tab !== 'links'} className={ui.panel}>
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
                    shop: open ? { position: current.links.length, size: null, itemCount: current.shopTab?.itemCount ?? 0, photoKey: null, photos: [] } : null,
                  }))
                }
              />
            ) : null}
          </div>

          <div role="tabpanel" id="panel-appearance" aria-labelledby="tab-appearance" hidden={tab !== 'appearance'} className={ui.panel}>
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

        <PreviewFrame
          label="Live preview"
          tabsLabel="Preview tab"
          tabs={previewTabs.map((id) => ({ id, label: id === 'links' ? 'Links' : 'Ask' }))}
          selected={shownPreview}
          onSelect={setPreviewTab}
          overlay={
            // The ask bar belongs to the Ask tab; the Links tab ends with the FAQ, as the page does.
            shownPreview === 'ask' ? (
            <span className={styles.askBar} style={{ '--accent': page.accentColor } as CSSProperties} aria-hidden="true">
              Ask {page.displayName} anything
              <i>
                <svg viewBox="0 0 24 24" width="13" height="13">
                  <path d="M12 19V5M5 12l7-7 7 7" />
                </svg>
              </i>
            </span>
            ) : null
          }
        >
          <BentoPage
            {...page}
            shop={previewPill}
            faq={page.faq}
            mode={shownPreview === 'ask' ? 'chat' : undefined}
            interactive={false}
            nameAs="p"
          >
            <PreviewTabBody
              tab={shownPreview}
              hasLinks={page.links.length > 0}
              question={page.previewQuestion}
              askPage={api.askPage}
              accent={page.accentColor}
              name={page.displayName}
            />
          </BentoPage>
        </PreviewFrame>
      </div>
    </>
  );
}

/** What the preview shows under the tabs that BentoPage leaves to its caller. */
/**
 * The preview's Ask tab, as the board draws it: a customer's question and the
 * page's answer. The question is real (the most asked, or a starter), and so
 * is the answer -- the owner taps for it, and the tester asks the page, so it
 * never shows a sample answer the page would not give, and a model call is
 * spent only when asked for.
 */
function PreviewAsk({ question, askPage, accent, name }: { question: string; askPage: CuriosApi['askPage']; accent: string; name: string }) {
  const [state, setState] = useState<{ kind: 'idle' } | { kind: 'asking' } | { kind: 'answered'; reply: string } | { kind: 'failed' }>({ kind: 'idle' });

  async function ask() {
    setState({ kind: 'asking' });
    try {
      setState({ kind: 'answered', reply: (await askPage(question)).reply });
    } catch {
      setState({ kind: 'failed' });
    }
  }

  return (
    <span className={styles.pvChat} style={{ '--accent': accent } as CSSProperties}>
      <VisitorQuestion onPage>{question}</VisitorQuestion>
      {state.kind === 'answered' ? (
        <PageReply name={name} onPage>{state.reply}</PageReply>
      ) : state.kind === 'asking' ? (
        <PageReply name={name} label="Inquiring" onPage>
          <Thinking />
        </PageReply>
      ) : (
        <button type="button" className={styles.pvTap} onClick={() => void ask()}>
          {state.kind === 'failed' ? 'That did not work. Tap to try again' : 'Tap to hear what your page says'}
        </button>
      )}
    </span>
  );
}

function PreviewTabBody({
  tab,
  hasLinks,
  question,
  askPage,
  accent,
  name,
}: {
  tab: PreviewTab;
  hasLinks: boolean;
  question: string;
  askPage: CuriosApi['askPage'];
  accent: string;
  name: string;
}) {
  if (tab === 'links') return hasLinks ? null : <span className={styles.previewEmpty}>Your links show here</span>;
  return <PreviewAsk question={question} askPage={askPage} accent={accent} name={name} />;
}
