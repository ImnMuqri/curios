import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('next/navigation', () => ({ usePathname: () => '/app/curios' }));
const { AppFrame } = await import('./app-frame.js');

const frame = (pendingReview = 3) =>
  render(
    <AppFrame displayName="Iman Muqri" handle="imnmuqri" pendingReview={pendingReview}>
      <p>content</p>
    </AppFrame>,
  );

describe('AppFrame', () => {
  it('groups the modules, My Curios first', () => {
    frame();
    const nav = screen.getByRole('navigation', { name: 'Dashboard' });
    expect(within(nav).getAllByRole('link').map((a) => a.textContent)).toEqual([
      'My Curios',
      'Review3',
      'Add a source',
      'Questions',
      'Leads',
      'Billing',
      'Settings',
    ]);
  });

  it('marks where the owner is', () => {
    frame();
    expect(screen.getByRole('link', { name: 'My Curios' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /review/i })).not.toHaveAttribute('aria-current');
  });

  it('shows no count when nothing is waiting', () => {
    frame(0);
    expect(screen.getByRole('link', { name: 'Review' }).textContent).toBe('Review');
  });

  it('links to the public page, and shows no live badge', () => {
    frame();
    expect(screen.getByRole('link', { name: /view page/i })).toHaveAttribute('href', '/imnmuqri');
    expect(screen.queryByText(/^live$/i)).toBeNull();
  });

  // On a phone the sidebar folds away behind a menu button.
  it('opens and closes the menu', async () => {
    frame();
    const toggle = screen.getByRole('button', { name: /menu/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  it('renders the screen it wraps', () => {
    frame();
    expect(screen.getByText('content')).toBeInTheDocument();
  });

  // Fix round 2, Important #3: without this, My Curios, Review, Settings and
  // onboarding-with-a-page have no main landmark at all -- a div is not one.
  it('gives the screen it wraps exactly one main landmark', () => {
    frame();
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getByRole('main')).toHaveTextContent('content');
  });

  // The given tests above check the sidebar's links but never its "who"
  // block or the top bar's breadcrumb -- both render straight from props, so
  // a mistake here (swapping displayName and handle, or a dead breadcrumb)
  // would leave every test above green.
  it("shows the owner's name, initials and handle", () => {
    frame();
    expect(screen.getByText('Iman Muqri')).toBeInTheDocument();
    expect(screen.getByText('IM')).toBeInTheDocument();
    expect(screen.getByText('curios.my/imnmuqri')).toBeInTheDocument();
  });

  it('names the current module in the breadcrumb', () => {
    frame();
    expect(screen.getByText('Your page / My Curios')).toBeInTheDocument();
  });

  // "opens and closes the menu" proves the button's own aria-expanded state.
  // It does not prove that state actually reaches the sidebar it is meant to
  // reveal -- a button that toggles itself but never touches the aside would
  // still pass that test.
  it('opens the sidebar itself, not just the button that controls it', async () => {
    frame();
    const sidebar = screen.getByRole('complementary');
    expect(sidebar).toHaveAttribute('data-open', 'false');

    await userEvent.click(screen.getByRole('button', { name: /menu/i }));
    expect(sidebar).toHaveAttribute('data-open', 'true');
  });
});
