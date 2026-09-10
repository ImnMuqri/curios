import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Nav } from './Nav.js';

const items = [
  { href: '/app/review', label: 'Review' },
  { href: '/app/questions', label: 'Questions' },
  { href: '/app/leads', label: 'Leads' },
  { href: '/app/settings', label: 'Settings' },
];

describe('Nav', () => {
  it('renders every destination as a real link', () => {
    // Real anchors, so middle-click and open-in-new-tab work and the
    // dashboard is navigable before any JavaScript runs.
    render(<Nav items={items} />);
    expect(screen.getAllByRole('link')).toHaveLength(4);
    expect(screen.getByRole('link', { name: 'Leads' })).toHaveAttribute('href', '/app/leads');
  });

  it('marks the current page for assistive technology, not only visually', () => {
    render(<Nav items={items} current="/app/leads" />);
    expect(screen.getByRole('link', { name: 'Leads' })).toHaveAttribute('aria-current', 'page');
  });

  it('marks nothing when the current page is not one of them', () => {
    render(<Nav items={items} current="/app/onboarding" />);
    expect(screen.queryByRole('link', { current: 'page' })).not.toBeInTheDocument();
  });

  it('is a navigation landmark, so it can be skipped', () => {
    render(<Nav items={items} />);
    expect(screen.getByRole('navigation')).toBeInTheDocument();
  });
});
