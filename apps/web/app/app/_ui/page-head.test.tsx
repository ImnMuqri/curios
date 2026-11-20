import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({ usePathname: () => '/app/orders' }));
const { PageHead } = await import('./page-head.js');
const css = readFileSync(path.resolve(__dirname, './page-head.module.css'), 'utf8');

describe('PageHead', () => {
  it('renders the kicker above the title, and nothing without one', () => {
    const { rerender } = render(<PageHead kicker="Inbox" title="Orders" />);
    expect(screen.getByText('Inbox')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Orders' })).toBeInTheDocument();
    rerender(<PageHead title="Orders" />);
    expect(screen.queryByText('Inbox')).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Orders' })).toBeInTheDocument();
  });

  it('only marks the head hasKicker when there is a kicker (the actions drop only then)', () => {
    const { container, rerender } = render(<PageHead title="Orders">x</PageHead>);
    expect(container.querySelector('header')!.className).not.toContain('hasKicker');
    rerender(<PageHead kicker="Inbox" title="Orders">x</PageHead>);
    expect(container.querySelector('header')!.className).toContain('hasKicker');
    rerender(<PageHead kicker="Inbox" title="Orders" beside={<i />}>x</PageHead>);
    expect(container.querySelector('header')!.className).toMatch(/withBeside.*hasKicker|hasKicker.*withBeside/);
  });

  it('sizes the title 40px, 34px at 1100 and under, 32px at 760 and under', () => {
    expect(css).toMatch(/\.title \{[^}]*font-size: 40px;[^}]*letter-spacing: -0\.04em;/);
    expect(css).toMatch(/@media \(max-width: 1100px\) \{\s*\.title \{\s*font-size: 34px;/);
    expect(css).toMatch(/@media \(max-width: 760px\) \{[\s\S]*?\.title \{\s*font-size: 32px;/);
  });

  it('sets the kicker, the summary and the actions as the board does', () => {
    expect(css).toMatch(
      /\.kicker \{[^}]*font-size: 12\.5px;[^}]*font-weight: 600;[^}]*letter-spacing: 0\.06em;[^}]*text-transform: uppercase;[^}]*var\(--muted\)/,
    );
    expect(css).toMatch(/\.summary \{\s*margin: 8px 0 0;\s*font-size: 15\.5px;/);
    expect(css).toMatch(/\.hasKicker \.actions \{\s*padding-top: 30px;/);
    expect(css).toMatch(/@media \(max-width: 760px\) \{[\s\S]*?\.hasKicker \.actions \{\s*padding-top: 18px;/);
    expect(css).not.toMatch(/(^|\n)\.actions \{[^}]*padding-top/);
  });

  it('marks the summary and the actions, so an inbox own-view can hide them on a phone', () => {
    const { container } = render(
      <PageHead title="Orders" summary="One receipt to check.">
        <a href="/x">See your shop</a>
      </PageHead>,
    );
    const parts = [...container.querySelectorAll('[data-head-part]')].map((el) => el.getAttribute('data-head-part'));
    expect(parts).toEqual(['summary', 'actions']);
    expect(screen.getByRole('heading', { level: 1 }).closest('[data-head-part]')).toBeNull();
  });
});
