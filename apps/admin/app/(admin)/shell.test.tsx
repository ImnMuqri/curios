import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({ usePathname: () => '/', useRouter: () => ({ replace: vi.fn() }) }));

import { Shell } from './shell.js';

describe('Shell', () => {
  it('shows the three built sections and none of the unbuilt ones', () => {
    render(<Shell adminName="Iman" current="pages" />);

    const nav = screen.getByRole('navigation');
    const labels = Array.from(nav.querySelectorAll('a')).map((a) => a.textContent);
    expect(labels).toEqual(['Overview', 'Pages', 'Audit log']);
    for (const absent of ['AI & usage', 'Reading sources', 'Payments', 'Reports', 'Controls', 'Run']) {
      expect(screen.queryByText(absent)).not.toBeInTheDocument();
    }
    expect(screen.getByText('Look')).toBeInTheDocument();
    expect(screen.getByText('Change')).toBeInTheDocument();
  });

  it('marks the current section', () => {
    render(<Shell adminName="Iman" current="pages" />);

    expect(screen.getByRole('link', { name: 'Pages' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Overview' })).not.toHaveAttribute('aria-current');
  });

  it('links to the three screens', () => {
    render(<Shell adminName="Iman" current="overview" />);

    expect(screen.getByRole('link', { name: 'Overview' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Pages' })).toHaveAttribute('href', '/pages');
    expect(screen.getByRole('link', { name: 'Audit log' })).toHaveAttribute('href', '/audit');
  });

  it('carries the production strip on every screen', () => {
    render(<Shell adminName="Iman" current="audit" />);

    expect(screen.getByText('Production. Changes here reach every page on Curios.')).toBeInTheDocument();
  });

  it('names the admin and how they signed in', () => {
    render(<Shell adminName="Iman Mukri" current="overview" />);

    expect(screen.getByText('Iman Mukri')).toBeInTheDocument();
    expect(screen.getByText('Admin · email and password')).toBeInTheDocument();
  });
});
