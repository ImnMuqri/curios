import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InlineConfirm } from './inline-confirm.js';

function setup(onYes = vi.fn()) {
  render(
    <InlineConfirm trigger="Cancel order" question="Cancel #14? You will owe Mira RM235." yes="Yes, cancel" no="Keep it" onYes={onYes} />,
  );
  return { onYes, user: userEvent.setup() };
}

describe('InlineConfirm', () => {
  it('opens on the trigger, asks, and puts focus on the way out', async () => {
    const { user } = setup();
    const trigger = screen.getByRole('button', { name: 'Cancel order' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('group')).toBeNull();
    await user.click(trigger);
    const panel = screen.getByRole('group', { name: 'Cancel order' });
    expect(panel).toHaveTextContent('Cancel #14? You will owe Mira RM235.');
    expect(screen.getByRole('button', { name: 'Keep it' })).toHaveFocus();
    expect(screen.queryByRole('button', { name: 'Cancel order' })).toBeNull();
  });

  it('closes on Escape and gives focus back to the trigger', async () => {
    const { user, onYes } = setup();
    await user.click(screen.getByRole('button', { name: 'Cancel order' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('group')).toBeNull();
    expect(screen.getByRole('button', { name: 'Cancel order' })).toHaveFocus();
    expect(onYes).not.toHaveBeenCalled();
  });

  it('works from the keyboard alone: Enter opens, Tab back to yes, Enter confirms', async () => {
    const { user, onYes } = setup();
    screen.getByRole('button', { name: 'Cancel order' }).focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: 'Keep it' })).toHaveFocus();
    await user.keyboard('{Shift>}{Tab}{/Shift}');
    expect(screen.getByRole('button', { name: 'Yes, cancel' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onYes).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('group')).toBeNull();
    expect(screen.getByRole('button', { name: 'Cancel order' })).toHaveFocus();
  });

  it('closes on the way out without the move', async () => {
    const { user, onYes } = setup();
    await user.click(screen.getByRole('button', { name: 'Cancel order' }));
    await user.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(onYes).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Cancel order' })).toHaveFocus();
  });

  it('sends once: while yes is in flight the panel stays, busy, and a second press does nothing', async () => {
    let settle!: () => void;
    const onYes = vi.fn(() => new Promise<void>((r) => (settle = r)));
    const { user } = setup(onYes);
    await user.click(screen.getByRole('button', { name: 'Cancel order' }));
    const yesPill = screen.getByRole('button', { name: 'Yes, cancel' });
    await user.dblClick(yesPill);
    await user.click(yesPill);
    expect(onYes).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('group')).toHaveAttribute('aria-busy', 'true');
    expect(yesPill).toHaveAttribute('aria-disabled', 'true');
    // The way out waits too, and the trigger is not back to press again.
    await user.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(screen.getByRole('group')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel order' })).toBeNull();
    await act(async () => settle());
    expect(screen.queryByRole('group')).toBeNull();
    expect(screen.getByRole('button', { name: 'Cancel order' })).toHaveFocus();
  });

  it('stays open and live again when yes fails, and says so (no unhandled rejection)', async () => {
    const onYes = vi.fn(() => Promise.reject(new Error('409')));
    const { user } = setup(onYes);
    await user.click(screen.getByRole('button', { name: 'Cancel order' }));
    await user.click(screen.getByRole('button', { name: 'Yes, cancel' }));
    expect(screen.getByRole('group')).not.toHaveAttribute('aria-busy');
    expect(screen.getByRole('alert')).toHaveTextContent('That did not go through. Try again.');
    expect(screen.getByRole('button', { name: 'Yes, cancel' })).not.toHaveAttribute('aria-disabled');
    await user.click(screen.getByRole('button', { name: 'Yes, cancel' }));
    expect(onYes).toHaveBeenCalledTimes(2);
  });

  it('hands a failure to onError instead, when the page has a toast', async () => {
    const onError = vi.fn();
    const error = new Error('409');
    const user = userEvent.setup();
    render(<InlineConfirm trigger="Not received" question="Sure?" yes="Yes" no="Keep it" onYes={() => Promise.reject(error)} onError={onError} />);
    await user.click(screen.getByRole('button', { name: 'Not received' }));
    await user.click(screen.getByRole('button', { name: 'Yes' }));
    expect(onError).toHaveBeenCalledWith(error);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('group')).toBeInTheDocument();
  });

  it('puts the done line in its place after a successful yes', async () => {
    const user = userEvent.setup();
    render(<InlineConfirm trigger="Cancel order" question="Sure?" yes="Yes, cancel" no="Keep it" done="Done." onYes={async () => {}} />);
    await user.click(screen.getByRole('button', { name: 'Cancel order' }));
    await user.click(screen.getByRole('button', { name: 'Yes, cancel' }));
    expect(screen.getByRole('status')).toHaveTextContent('Done.');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('can be controlled, so a page keeps one confirm open at a time', async () => {
    function Two() {
      const [confirming, setConfirming] = useState<string | null>(null);
      const props = (id: string) => ({
        open: confirming === id,
        onOpenChange: (o: boolean) => setConfirming(o ? id : null),
      });
      return (
        <>
          <InlineConfirm trigger="Cancel order" question="Cancel?" yes="Yes, cancel" no="Keep it" onYes={() => {}} {...props('cancel')} />
          <InlineConfirm trigger="Not received" question="Not received?" yes="Yes, not received" no="Keep it" onYes={() => {}} {...props('nr')} />
        </>
      );
    }
    const user = userEvent.setup();
    render(<Two />);
    await user.click(screen.getByRole('button', { name: 'Cancel order' }));
    expect(screen.getByRole('group', { name: 'Cancel order' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep it' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Not received' }));
    expect(screen.getAllByRole('group')).toHaveLength(1);
    expect(screen.getByRole('group', { name: 'Not received' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel order' })).toBeVisible();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('group')).toBeNull();
    expect(screen.getByRole('button', { name: 'Not received' })).toHaveFocus();
  });
});
