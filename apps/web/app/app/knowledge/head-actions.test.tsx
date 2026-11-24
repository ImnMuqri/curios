import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

const { HeadActions } = await import('./head-actions.js');
const { ADD_FACT_EVENT } = await import('./facts-tab.js');

describe('HeadActions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('opens "Ask your page" as a sheet from "Try your page", and Escape returns focus to the button', async () => {
    render(<HeadActions tab="facts" pageName="Nadia" suggestions={[]} />);
    const open = screen.getByRole('button', { name: 'Try your page' });
    expect(screen.queryByRole('dialog', { name: 'Ask your page' })).toBeNull();
    await userEvent.click(open);
    expect(await screen.findByRole('dialog', { name: 'Ask your page' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Ask your page' })).toBeNull();
    expect(open).toHaveFocus();
  });

  it('asks the open Facts tab for its add line', async () => {
    const heard = vi.fn();
    window.addEventListener(ADD_FACT_EVENT, heard);
    render(<HeadActions tab="facts" suggestions={[]} />);
    await userEvent.click(screen.getByRole('button', { name: '+ Add a fact' }));
    expect(heard).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
    window.removeEventListener(ADD_FACT_EVENT, heard);
  });

  it('goes to the Facts tab with the add line open from any other tab', async () => {
    render(<HeadActions tab="sources" suggestions={[]} />);
    await userEvent.click(screen.getByRole('button', { name: '+ Add a fact' }));
    expect(push).toHaveBeenCalledWith('/app/knowledge?tab=facts&add=1');
  });
});
