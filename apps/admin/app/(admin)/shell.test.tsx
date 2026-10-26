import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({ usePathname: () => '/', useRouter: () => ({ replace: vi.fn() }) }));

import { Shell } from './shell.js';

describe('Shell', () => {
  it('shows the built sections in the board’s groups and none of the unbuilt ones', () => {
    render(<Shell adminName="Iman" current="pages" />);

    const nav = screen.getByRole('navigation');
    const labels = Array.from(nav.querySelectorAll('a')).map((a) => a.textContent);
    expect(labels).toEqual(['Overview', 'Pages', 'Reports', 'Audit log']);
    for (const absent of ['AI & usage', 'Reading sources', 'Payments', 'Controls']) {
      expect(screen.queryByText(absent)).not.toBeInTheDocument();
    }
    const groups = Array.from(nav.querySelectorAll('p')).map((p) => p.textContent);
    expect(groups).toEqual(['Look', 'Run', 'Change']);
  });

  it('shows the open reports count beside Reports, and hides it at 0', () => {
    const { rerender } = render(
      <Shell adminName="Iman" current="pages" counts={{ failedSources: 0, failedWebhooks: 0, openReports: 3 }} />,
    );
    expect(screen.getByRole('link', { name: 'Reports 3' })).toHaveAttribute('href', '/reports');

    rerender(<Shell adminName="Iman" current="pages" counts={{ failedSources: 0, failedWebhooks: 0, openReports: 0 }} />);
    expect(screen.getByRole('link', { name: 'Reports' })).toBeInTheDocument();
    rerender(<Shell adminName="Iman" current="pages" />);
    expect(screen.getByRole('link', { name: 'Reports' })).toBeInTheDocument();
  });

  it('marks the current section', () => {
    render(<Shell adminName="Iman" current="pages" />);

    expect(screen.getByRole('link', { name: 'Pages' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Overview' })).not.toHaveAttribute('aria-current');
  });

  it('links to the screens', () => {
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
