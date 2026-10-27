import { describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({ usePathname: () => '/', useRouter: () => ({ replace: vi.fn() }) }));

import { Shell } from './shell.js';

describe('Shell', () => {
  it('scrolls the current item into view sideways on the phone bar, and not on desktop', () => {
    const scrollIntoView = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
    render(<Shell adminName="Iman" current="controls" />);
    expect(scrollIntoView).not.toHaveBeenCalled();
    cleanup();

    const phone = vi.spyOn(window, 'matchMedia').mockImplementation(
      (query) => ({ matches: query === '(max-width: 860px)', media: query }) as MediaQueryList,
    );
    render(<Shell adminName="Iman" current="controls" />);

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ inline: 'nearest' }));
    expect(scrollIntoView.mock.contexts[0]).toBe(screen.getByRole('link', { name: 'Controls' }));
    scrollIntoView.mockRestore();
    phone.mockRestore();
  });

  it('shows all eight sections in the board’s groups', () => {
    render(<Shell adminName="Iman" current="pages" />);

    const nav = screen.getByRole('navigation');
    const labels = Array.from(nav.querySelectorAll('a')).map((a) => a.textContent);
    expect(labels).toEqual(['Overview', 'Pages', 'AI & usage', 'Reading sources', 'Payments', 'Reports', 'Controls', 'Audit log']);
    const groups = Array.from(nav.querySelectorAll('p')).map((p) => p.textContent);
    expect(groups).toEqual(['Look', 'Run', 'Change']);
    expect(screen.getByRole('link', { name: 'AI & usage' })).toHaveAttribute('href', '/ai');
    expect(screen.getByRole('link', { name: 'Reading sources' })).toHaveAttribute('href', '/sources');
    expect(screen.getByRole('link', { name: 'Payments' })).toHaveAttribute('href', '/payments');
  });

  it('puts each count beside its section, and hides it at 0', () => {
    const { rerender } = render(
      <Shell adminName="Iman" current="pages" counts={{ failedSources: 4, failedWebhooks: 2, openReports: 0 }} />,
    );
    expect(screen.getByRole('link', { name: 'Reading sources 4' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Payments 2' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Reports' })).toBeInTheDocument();

    rerender(<Shell adminName="Iman" current="pages" counts={{ failedSources: 0, failedWebhooks: 0, openReports: 0 }} />);
    expect(screen.getByRole('link', { name: 'Reading sources' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Payments' })).toBeInTheDocument();
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
    expect(screen.getByRole('link', { name: 'Controls' })).toHaveAttribute('href', '/controls');
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
