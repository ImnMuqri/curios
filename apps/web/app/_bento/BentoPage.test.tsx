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
  accentColor: '#0c7a62',
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
});
