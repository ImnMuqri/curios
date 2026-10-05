import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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
  it('renders every link as a real link, in order, with its kind', () => {
    render(<BentoPage {...base} />);
    const links = screen.getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['https://iman.dev', 'https://wa.me/60123', 'https://github.com/iman']);
    expect(screen.getByText('WhatsApp')).toBeInTheDocument();
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

  it('gives each tile its arranged size and tone', () => {
    render(<BentoPage {...base} />);
    const [first, second, third] = screen.getAllByRole('link');
    expect(first).toHaveAttribute('data-size', 'TALL');
    expect(first).toHaveAttribute('data-tone', 'accent');
    expect(second).toHaveAttribute('data-tone', 'warm');
    expect(third).toHaveAttribute('data-size', 'SMALL');
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
  it('renders no empty grid for a page with no links', () => {
    const { container } = render(<BentoPage {...base} links={[]} />);
    expect(container.querySelector('[data-bento-grid]')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Iman Muqri' })).toBeInTheDocument();
  });

  it('renders tiles as plain boxes in the editor preview, so they cannot navigate', () => {
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
    expect(css).toMatch(/\[data-style='CONTRAST'\][^}]*--ask-border:\s*var\(--ink\);/s);
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
  it('marks its own root as the page chat mode looks for, and the bio/grid block it collapses', () => {
    const { container } = render(<BentoPage {...base} />);
    const page = container.firstElementChild as HTMLElement;
    expect(page).toHaveAttribute('data-bento-page');

    const foldaway = page.querySelector('[data-foldaway]');
    expect(foldaway).not.toBeNull();
    expect(foldaway?.textContent).toContain(base.bio);
    expect(foldaway?.querySelector('[data-bento-grid]')).not.toBeNull();
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

    // The ask bar becomes the composer in the same spot -- hidden, not
    // replaced by something appearing elsewhere -- and the prompt (chat
    // mode's own empty-state greeting) gives way to the transcript.
    expect(css).toMatch(/\[data-mode='chat'\]\s*\[data-ask-bar\]\s*\{[^}]*display:\s*none;/s);
    expect(css).toMatch(/\[data-has-turns\]\s*\[data-ask-prompt\]\s*\{[^}]*display:\s*none;/s);
  });

  // Fix round: the owner saw the back arrow render "in the middle" -- caused
  // by ChatMode.module.css's `.panel` claiming `position: relative` for
  // itself, which made it the containing block for `.back`'s `position:
  // absolute` instead of letting it skip through to this `.page`. Half of
  // that fix lives in ChatMode.module.css (its own test pins `.panel`
  // declaring no position); this half is the room `.head` makes for the
  // arrow once it does correctly anchor here. Pinned together so the two
  // sides of this cross-package pairing cannot drift apart silently again.
  // Once the window is wider than the 520px column, it reads as a card --
  // space above and below and rounded corners -- while a phone keeps it edge
  // to edge, so the rule must live inside a min-width query, not on .page.
  it('spaces and rounds the column on wide screens only', () => {
    const css = readFileSync(join(import.meta.dirname, 'Bento.module.css'), 'utf8');
    const wide = css.match(/@media \(min-width: 560px\)\s*\{\s*\.page\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(wide).toMatch(/margin:\s*24px auto;/);
    expect(wide).toMatch(/border-radius:\s*20px;/);
    expect(wide).toMatch(/min-height:\s*calc\(100vh - 48px\);/);
    const base = css.match(/^\.page\s*\{([^}]*)\}/m)?.[1] ?? '';
    expect(base).toMatch(/margin:\s*0 auto;/);
    expect(base).not.toMatch(/border-radius/);
  });

  it("keeps .head's room for the back button, so a fixed .panel elsewhere does not leave it stranded with nowhere to sit", () => {
    const css = readFileSync(join(import.meta.dirname, 'Bento.module.css'), 'utf8');
    expect(css).toMatch(/\[data-mode='chat'\]\s*\.head\s*\{[^}]*padding-left:\s*44px;/s);
  });
});

describe('BentoPage High contrast follows the accent', () => {
  // The owner saw only the first tile change colour in High contrast: the
  // second was fixed kuning and the rest fixed ink. Every tile now takes the
  // accent: the second as a deep shade, the ink tiles in their label.
  it("derives the second tile and the ink tiles' labels from the accent, not a fixed colour", () => {
    const css = readFileSync(join(import.meta.dirname, 'Bento.module.css'), 'utf8');
    const contrast = css.match(/\.page\[data-style='CONTRAST'\]\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(contrast).toMatch(/--warm:\s*color-mix\([^;]*var\(--accent\)/);
    expect(contrast).not.toMatch(/--warm:\s*var\(--kuning\)/);
    expect(contrast).toMatch(/--warm-fg:\s*var\(--paper\)/);
    expect(contrast).toMatch(/--plain-kind:\s*color-mix\([^;]*var\(--accent\)/);
    expect(css).toMatch(/\.tile\[data-tone='warm'\]\s*\{[^}]*color:\s*var\(--warm-fg\)/);
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
    expect(css).toMatch(/\[data-bg-text='light'\] \.tile\[data-tone='accent'\]/);
  });
});
