import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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
});
