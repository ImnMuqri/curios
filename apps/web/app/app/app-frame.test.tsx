import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { NavBadges } from '@curios/db-read';

vi.mock('next/navigation', () => ({ usePathname: () => '/app/curios' }));
const { AppFrame } = await import('./app-frame.js');

const frame = ({
  badges = { review: 3, questions: 0, leads: 0 },
  mode = 'PERSONAL',
  avatarUrl = null,
}: { badges?: NavBadges; mode?: 'PERSONAL' | 'BUSINESS'; avatarUrl?: string | null } = {}) =>
  render(
    <AppFrame displayName="Iman Muqri" avatarUrl={avatarUrl} planLabel="Personal page" badges={badges} mode={mode}>
      <p>content</p>
    </AppFrame>,
  );

const links = () => within(screen.getByRole('navigation', { name: 'Dashboard' })).getAllByRole('link');

describe('AppFrame', () => {
  it('groups the modules as Page, Inbox, Knowledge and Account', () => {
    frame();
    expect(links().map((a) => a.textContent)).toEqual([
      'My Curios',
      'Questions',
      'Leads',
      'Review3',
      'Facts & sources',
      'Billing',
      'Settings',
    ]);
    const nav = screen.getByRole('navigation', { name: 'Dashboard' });
    expect(['Page', 'Inbox', 'Knowledge', 'Account'].map((group) => within(nav).getByText(group))).toHaveLength(4);
  });

  it('shows a business page a Store link, after My Curios', () => {
    frame({ mode: 'BUSINESS' });
    expect(screen.getByRole('link', { name: 'Store' })).toHaveAttribute('href', '/app/store');
    expect(links().map((a) => a.textContent).slice(0, 2)).toEqual(['My Curios', 'Store']);
  });

  it('shows a personal page no Store link', () => {
    frame({ mode: 'PERSONAL' });
    expect(screen.queryByRole('link', { name: 'Store' })).toBeNull();
  });

  it('sends Facts & sources to the Knowledge screen', () => {
    frame();
    expect(screen.getByRole('link', { name: 'Facts & sources' })).toHaveAttribute('href', '/app/knowledge');
  });

  it('marks where the owner is', () => {
    frame();
    expect(screen.getByRole('link', { name: 'My Curios' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /review/i })).not.toHaveAttribute('aria-current');
  });

  it('counts what is waiting beside Review, Questions and Leads', () => {
    frame({ badges: { review: 3, questions: 4, leads: 2 } });
    expect(screen.getByRole('link', { name: /review/i }).textContent).toBe('Review3');
    expect(screen.getByRole('link', { name: /questions/i }).textContent).toBe('Questions4');
    expect(screen.getByRole('link', { name: /leads/i }).textContent).toBe('Leads2');
  });

  it('shows no count when nothing is waiting', () => {
    frame({ badges: { review: 0, questions: 0, leads: 0 } });
    expect(screen.getByRole('link', { name: 'Review' }).textContent).toBe('Review');
    expect(screen.getByRole('link', { name: 'Questions' }).textContent).toBe('Questions');
  });

  it('renders the screen it wraps inside exactly one main landmark', () => {
    frame();
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getByRole('main')).toHaveTextContent('content');
  });

  // Both render straight from props, so swapping them would leave every test
  // above green.
  it("shows the owner's name, initials and plan", () => {
    frame();
    expect(screen.getByText('Iman Muqri')).toBeInTheDocument();
    expect(screen.getByText('IM')).toBeInTheDocument();
    expect(screen.getByText('Personal page')).toBeInTheDocument();
  });

  it("shows the owner's picture in place of initials when there is one", () => {
    const { container } = frame({ avatarUrl: 'https://cdn.example/a.webp' });
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://cdn.example/a.webp');
    expect(screen.queryByText('IM')).toBeNull();
  });
});
