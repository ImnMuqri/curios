import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { BentoPage, type BentoPageProps } from './BentoPage.js';

const base: BentoPageProps = {
  displayName: 'Iman Muqri',
  handle: 'imnmuqri',
  bio: 'Software developer.',
  avatarUrl: null,
  style: 'SOFT',
  accentColor: '#2340c8',
  headingFont: 'JAKARTA',
  links: [
    { id: 'a', label: 'Portfolio', url: 'https://iman.dev', size: null },
    { id: 'b', label: 'Chat', url: 'https://wa.me/60123', size: null },
    { id: 'c', label: 'Code', url: 'https://github.com/iman', size: null },
  ],
};

describe('BentoPage', () => {
  it('renders every link as a real link, in order', () => {
    render(<BentoPage {...base} />);
    const links = within(screen.getByRole('list')).getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['https://iman.dev', 'https://wa.me/60123', 'https://github.com/iman']);
    expect(links.map((a) => a.textContent)).toEqual(['Portfolio', 'Chat', 'Code']);
  });

  it("renders the owner's name as the page heading unless told otherwise", () => {
    // The landing page embeds a demo page under its own h1. Two h1s would
    // leave a screen reader -- and a search engine -- two answers to "what is
    // this page".
    const { unmount } = render(<BentoPage {...base} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Iman Muqri' })).toBeInTheDocument();
    unmount();

    render(<BentoPage {...base} nameAs="p" />);
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    expect(screen.getByText('Iman Muqri').tagName).toBe('P');
  });

  // Every link is a pill now; the first is the one the owner most wants
  // pressed, so it alone wears the accent. Read from the stylesheet: this
  // package's vitest config has no `css: true`.
  it('draws every link as a pill, the first in the accent', () => {
    const css = readFileSync(join(import.meta.dirname, 'Bento.module.css'), 'utf8');
    expect(css).toMatch(/\.link > span\s*\{[^}]*border-radius:\s*999px;/s);
    expect(css).toMatch(/\.links > li:first-child \.link > span\s*\{[^}]*background:\s*var\(--accent\);/s);
  });

  it('carries the style, accent and readable text colour to the stylesheet', () => {
    const { container } = render(<BentoPage {...base} style="CONTRAST" accentColor="#f2a33c" headingFont="FRAUNCES" />);
    const page = container.firstElementChild as HTMLElement;
    expect(page).toHaveAttribute('data-style', 'CONTRAST');
    expect(page).toHaveAttribute('data-on-accent', 'dark');
    expect(page.style.getPropertyValue('--accent')).toBe('#f2a33c');
    expect(page.style.getPropertyValue('--font-heading')).toBe('var(--font-fraunces)');
  });

  // The spec: "Only show the picture if user upload."
  it('shows no picture and no placeholder when none was uploaded', () => {
    render(<BentoPage {...base} />);
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('shows the picture beside the name when there is one', () => {
    render(<BentoPage {...base} avatarUrl="https://cdn.example/avatars/p/1.webp" />);
    expect(screen.getByRole('img', { name: 'Iman Muqri' })).toHaveAttribute('src', 'https://cdn.example/avatars/p/1.webp');
  });

  // Fix round 1: Avatar's onError path -- storage down, an object removed --
  // was untested. The picture disappears; the name stands alone, never a
  // broken-image icon.
  it('hides the picture if it fails to load, and leaves the name standing alone', () => {
    render(<BentoPage {...base} avatarUrl="https://cdn.example/avatars/p/1.webp" />);
    const img = screen.getByRole('img', { name: 'Iman Muqri' });

    fireEvent.error(img);

    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Iman Muqri' })).toBeInTheDocument();
  });

  // Review Focus 5.
  it('renders no empty list for a page with no links', () => {
    render(<BentoPage {...base} links={[]} />);
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Iman Muqri' })).toBeInTheDocument();
  });

  it('renders links and tabs as plain boxes in the editor preview, so they cannot navigate', () => {
    render(<BentoPage {...base} interactive={false} />);
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(screen.getByText('Portfolio')).toBeInTheDocument();
  });

  // Fix round 2, Important #2: "a white pill, soft" in Soft (no ink
  // outline) and "outlined in ink" in High contrast -- the ask bar (rendered
  // as `children`, inside this same `.page`) reads `--ask-border` for that.
  // A rendered computed style would not prove the CONTRAST branch either,
  // since this package's own vitest config has no `css: true` -- read the
  // stylesheet itself, the way design-rules.test.ts does.
  it('sets --ask-border per style, so the ask bar it wraps can be borderless in Soft and ink-outlined in High contrast', () => {
    const css = readFileSync(join(import.meta.dirname, 'Bento.module.css'), 'utf8');
    expect(css).toMatch(/--ask-border:\s*transparent;/);
    expect(css).toMatch(/\[data-style='CONTRAST'\][^}]*--ask-border:\s*var\(--page-fg\);/s);
  });

  // M1: the editor's live preview renders this same `.page` nested inside
  // the dashboard's `.frame` (app-frame.module.css), which sets --font-body
  // and --font-display to Plus Jakarta Sans for its own chrome. Without its
  // own reset, the preview would show Jakarta where /:handle shows Inter and
  // Bricolage. Read the stylesheet directly, same reason as the tests above.
  it('resets the dashboard frame\'s Jakarta font variables back to the public page\'s own', () => {
    const css = readFileSync(join(import.meta.dirname, 'Bento.module.css'), 'utf8');
    expect(css).toMatch(/--font-body:\s*var\(--font-inter\);/);
    expect(css).toMatch(/--font-display:\s*var\(--font-bricolage,/);
  });

  // The sheet and the ask bar are not portalled -- both render as `children`
  // inside this same `.page` div -- which is what lets `--accent`,
  // `--on-accent` and `--ask-border` reach them by ordinary CSS inheritance.
  it('renders its children inside the styled page, not portalled elsewhere', () => {
    const { container } = render(
      <BentoPage {...base}>
        <p data-testid="child">the ask bar would render here</p>
      </BentoPage>,
    );
    const page = container.firstElementChild as HTMLElement;
    expect(page.querySelector('[data-testid="child"]')).toBe(screen.getByTestId('child'));
  });

  // The in-place chat mode rework: BentoPage is a server component and holds
  // no chat state itself, so `ChatMode` toggles `data-mode="chat"` on this
  // root by direct DOM mutation, reaching it through `closest()` from
  // wherever it is nested inside `children`. `data-bento-page` is the only
  // thing that makes that reachable at all -- without it, `closest()` would
  // walk straight past this div and find nothing.
  // The header -- name, bio and tabs -- stays on every tab; only the links
  // (and the FAQ under them) fold away.
  it('marks its own root as the page chat mode looks for, and the links block it collapses', () => {
    const { container } = render(<BentoPage {...base} />);
    const page = container.firstElementChild as HTMLElement;
    expect(page).toHaveAttribute('data-bento-page');

    const foldaway = page.querySelector('[data-foldaway]');
    expect(foldaway).not.toBeNull();
    expect(foldaway?.querySelector('ul')).not.toBeNull();
    expect(foldaway?.textContent).not.toContain(base.bio);
  });

  // Read the way every other stylesheet test in this file does: no `css: true`
  // in this package's vitest config, so a rendered element's computed style
  // would not reflect these rules regardless.
  it('collapses the foldaway block and hides the ask bar and prompt, keyed on data-mode/data-has-turns', () => {
    const css = readFileSync(join(import.meta.dirname, 'Bento.module.css'), 'utf8');

    // Anchors the back button (ChatMode.module.css, position: absolute) to
    // this column rather than the viewport.
    expect(css).toMatch(/\.page\s*\{[^}]*position:\s*relative;/s);

    // The fold: a single-row grid animating to a zero row, not display:none,
    // which is what makes it animatable at all.
    expect(css).toMatch(/\.foldaway\s*\{[^}]*grid-template-rows:\s*1fr;/s);
    expect(css).toMatch(/\[data-mode='chat'\]\s*\.foldaway\s*\{[^}]*grid-template-rows:\s*0fr;/s);
    expect(css).toMatch(/\[data-mode='chat'\]\s*\.foldawayInner\s*\{[^}]*opacity:\s*0;/s);

    // The shop page folds the same way.
    expect(css).toMatch(/\[data-mode='shop'\]\s*\.foldaway,[^{]*\{[^}]*grid-template-rows:\s*0fr;/s);
    expect(css).toMatch(/\[data-mode='shop'\]\s*\.foldawayInner,[^{]*\{[^}]*opacity:\s*0;/s);

    // The ask bar becomes the composer in the same spot -- hidden, not
    // replaced by something appearing elsewhere -- and the prompt (chat
    // mode's own empty-state greeting) gives way to the transcript.
    expect(css).toMatch(/\[data-mode='chat'\]\s*\[data-ask-bar\]\s*\{[^}]*display:\s*none;/s);
    expect(css).toMatch(/\[data-has-turns\]\s*\[data-ask-prompt\]\s*\{[^}]*display:\s*none;/s);
  });

  // Only the page at its own URL sits on a stage: inside the editor's phone
  // or a landing demo, the column is the whole thing.
  it('sits the 460px column on a stage only when asked to', () => {
    const css = readFileSync(join(import.meta.dirname, 'Bento.module.css'), 'utf8');
    expect(css).toMatch(/^\.page\s*\{[^}]*max-width:\s*460px;/m);

    const staged = render(<BentoPage {...base} stage coverUrl="/covers/teh.webp" />);
    const stage = staged.container.firstElementChild as HTMLElement;
    expect(stage).not.toHaveAttribute('data-bento-page');
    expect(stage.querySelector('[data-bento-page]')).not.toBeNull();
    // The blurred cover behind the column is decoration only.
    expect(stage.querySelector('[aria-hidden="true"] img')).toHaveAttribute('alt', '');
    staged.unmount();

    const { container } = render(<BentoPage {...base} />);
    expect(container.firstElementChild).toHaveAttribute('data-bento-page');
  });
});

describe('BentoPage High contrast', () => {
  // Solid pills in the page's own text colour, with a bold ring: on a pale
  // page that is ink, on a dark one paper, so it never needs a fixed colour.
  it("draws solid pills in the page's text colour", () => {
    const css = readFileSync(join(import.meta.dirname, 'Bento.module.css'), 'utf8');
    const contrast = css.match(/\.page\[data-style='CONTRAST'\]\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(contrast).toMatch(/--pill:\s*var\(--page-fg\)/);
    expect(contrast).toMatch(/--pill-fg:\s*var\(--page-bg\)/);
  });
});

describe('BentoPage cover and background', () => {
  it('draws the cover above the name only when there is one, and marks the band', () => {
    const { container, unmount } = render(<BentoPage {...base} coverUrl="/covers/teh.webp" background="MUDA" />);
    const page = container.firstElementChild as HTMLElement;
    expect(page).toHaveAttribute('data-bg', 'MUDA');
    // Decorative: the name under it says whose page it is.
    expect(container.querySelector('[data-cover-photo] img')).toHaveAttribute('alt', '');
    unmount();

    const plain = render(<BentoPage {...base} />);
    expect(plain.container.firstElementChild).toHaveAttribute('data-bg', 'PAPER');
    expect(plain.container.querySelector('[data-cover-photo]')).toBeNull();
  });

  it('drops a cover that fails to load, rather than showing a broken image', () => {
    const { container } = render(<BentoPage {...base} coverUrl="/covers/missing.webp" />);
    fireEvent.error(container.querySelector('[data-cover-photo] img')!);
    expect(container.querySelector('[data-cover-photo]')).toBeNull();
  });
});

describe('BentoPage, a custom background', () => {
  it("paints the owner's colour and picks the text that reads on it", () => {
    const light = render(<BentoPage {...base} background="CUSTOM" backgroundColor="#f4d9c8" />);
    const page = light.container.firstElementChild as HTMLElement;
    expect(page).toHaveAttribute('data-bg', 'CUSTOM');
    expect(page).toHaveAttribute('data-bg-text', 'dark');
    expect(page.style.getPropertyValue('--custom-bg')).toBe('#f4d9c8');
    light.unmount();

    const dark = render(<BentoPage {...base} background="CUSTOM" backgroundColor="#3b1f4a" />);
    expect(dark.container.firstElementChild).toHaveAttribute('data-bg-text', 'light');
  });

  it('falls back to the plain page when Custom has no usable colour', () => {
    const { container } = render(<BentoPage {...base} background="CUSTOM" backgroundColor={null} />);
    expect(container.firstElementChild).toHaveAttribute('data-bg', 'PAPER');
    expect(container.firstElementChild).not.toHaveAttribute('data-bg-text');
  });

  it('gives a dark custom colour the dark bands\' treatment, read from the stylesheet', () => {
    const css = readFileSync(join(import.meta.dirname, 'Bento.module.css'), 'utf8');
    expect(css).toMatch(/\[data-bg='CUSTOM'\]\[data-bg-text='light'\]\s*\{[^}]*--page-fg:\s*var\(--paper\)/);
    // A dark page's soft pills are its own text, faintly, not white.
    expect(css).toMatch(/\[data-bg-text='light'\]\)\s*\{[^}]*--pill:\s*var\(--veil-3\)/s);
  });
});

describe('BentoPage, drawn in chat mode', () => {
  // The landing page's storm shows a page mid-conversation; the public page
  // leaves mode out and ChatMode sets the same attribute when a visitor asks.
  it('carries data-mode="chat" only when asked to', () => {
    const chat = render(<BentoPage {...base} mode="chat" />);
    expect(chat.container.firstElementChild).toHaveAttribute('data-mode', 'chat');
    chat.unmount();

    const plain = render(<BentoPage {...base} />);
    expect(plain.container.firstElementChild).not.toHaveAttribute('data-mode');
  });
});

describe('the tabs', () => {
  const shop = {
    label: 'Shop',
    caption: '3 items · next pickup Sat 17 Oct',
    photos: [
      { url: '/p/a.jpg', name: 'Kek coklat' },
      { url: null, name: 'Batik' },
      { url: '/p/c.jpg', name: 'Cookies' },
    ],
  };
  const tabs = () => within(screen.getByRole('navigation', { name: 'Page sections' }));

  it('offers Links and Ask, Links current', () => {
    render(<BentoPage {...base} />);
    expect(tabs().getAllByRole('link').map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['Links', '/imnmuqri'],
      ['Ask', '/imnmuqri#ask'],
    ]);
    expect(tabs().getByRole('link', { name: 'Links' })).toHaveAttribute('aria-current', 'page');
  });

  it('a business page has Links and Ask tabs only, shop or no shop', () => {
    render(<BentoPage {...base} shop={shop} />);
    expect(tabs().getAllByRole('link').map((a) => a.textContent)).toEqual(['Links', 'Ask']);
    expect(tabs().queryByRole('link', { name: 'Shop' })).toBeNull();
  });

  it("speaks the page's language", () => {
    render(<BentoPage {...base} language="ms" shop={{ ...shop, label: 'Kedai' }} />);
    expect(screen.getByRole('navigation', { name: 'Bahagian halaman' })).toBeInTheDocument();
    expect(within(screen.getByRole('navigation', { name: 'Bahagian halaman' })).getAllByRole('link').map((a) => a.textContent)).toEqual(['Pautan', 'Tanya']);
  });
});

describe('the shop pill', () => {
  const shop = {
    label: 'Shop',
    caption: '3 items · next pickup Sat 17 Oct',
    photos: [
      { url: '/p/a.jpg', name: 'Kek coklat' },
      { url: null, name: 'Batik' },
      { url: '/p/c.jpg', name: 'Cookies' },
    ],
  };
  const linkList = () => screen.getByRole('list');

  it('is the first link: the shop, its photos, and "Shop · N items · next pickup …"', () => {
    const { container } = render(<BentoPage {...base} shop={shop} />);
    const links = within(linkList()).getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/imnmuqri/shop', 'https://iman.dev', 'https://wa.me/60123', 'https://github.com/iman']);
    expect(links[0]).toHaveTextContent('Shop');
    expect(links[0]).toHaveTextContent('3 items · next pickup Sat 17 Oct');
    expect(links[0]?.querySelectorAll('img')).toHaveLength(2);
    // The photo that is missing falls back to the item's initial.
    expect(links[0]).toHaveTextContent('B');
    expect(container.querySelectorAll('img[alt]:not([alt=""])')).toHaveLength(0);
  });

  it('is not drawn without a shop', () => {
    render(<BentoPage {...base} />);
    expect(screen.queryByRole('link', { name: /Shop/ })).toBeNull();
    expect(within(linkList()).getAllByRole('link')).toHaveLength(3);
  });

  it('is a box, not a link, in the editor preview', () => {
    render(<BentoPage {...base} shop={shop} interactive={false} />);
    expect(screen.queryByRole('link', { name: /Shop/ })).toBeNull();
    expect(screen.getByText('3 items · next pickup Sat 17 Oct')).toBeInTheDocument();
  });

  it('is drawn without the owner having links', () => {
    render(<BentoPage {...base} links={[]} shop={shop} />);
    expect(screen.getByRole('link', { name: /Shop/ })).toHaveAttribute('href', '/imnmuqri/shop');
  });

  it('keeps every selector on a local class, and the photos overlap by 12px', () => {
    const css = readFileSync(join(__dirname, 'Bento.module.css'), 'utf8');
    expect(css).toMatch(/\.shopPhoto\s*\+\s*\.shopPhoto\s*\{[^}]*margin-left:\s*-12px/s);
  });
});

describe('People often ask', () => {
  const faq = {
    total: 5,
    entries: [
      { slug: 'klang', question: 'Do you deliver to Klang?', answer: 'Yes, RM15.' },
      { slug: 'halal', question: 'Is it halal?', answer: 'Yes.' },
      { slug: 'sweet', question: 'Less sweet?', answer: 'Yes, say so.' },
      { slug: 'last', question: 'How long does it last?', answer: 'Three days.' },
    ],
  };

  it('opens the first few answers in place, the first already open, with the way to all of them', () => {
    const { container } = render(<BentoPage {...base} faq={faq} />);
    const items = container.querySelectorAll('details');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveAttribute('open');
    expect(items[1]).not.toHaveAttribute('open');
    expect(screen.getByRole('link', { name: 'See all 5' })).toHaveAttribute('href', '/imnmuqri/faq');
    expect(screen.getByRole('link', { name: 'Questions' })).toHaveAttribute('href', '/imnmuqri/faq');
  });

  it('is not there without answers, and neither is the Questions link', () => {
    render(<BentoPage {...base} faq={null} />);
    expect(screen.queryByText('People often ask')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Questions' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Made with Curios' })).toBeInTheDocument();
  });
});
