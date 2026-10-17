import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NotifyLeadsForm } from './notify-leads.js';

const SWITCH = { name: 'Email me when someone leaves their number' };

describe('NotifyLeadsForm', () => {
  it('turns the lead email off, and says leads still wait in Leads', async () => {
    const onChange = vi.fn(async () => undefined);
    render(<NotifyLeadsForm on onChange={onChange} />);

    await userEvent.click(screen.getByRole('switch', SWITCH));

    expect(onChange).toHaveBeenCalledWith(false);
    expect(screen.getByRole('switch', SWITCH)).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText('Off. New leads still wait in Leads.')).toBeInTheDocument();
  });

  it('puts the switch back, and says why, when the change could not be saved', async () => {
    render(<NotifyLeadsForm on onChange={vi.fn(async () => Promise.reject(new Error('Something failed on our side. Try again.')))} />);

    await userEvent.click(screen.getByRole('switch', SWITCH));

    expect(await screen.findByRole('alert')).toHaveTextContent('Something failed');
    expect(screen.getByRole('switch', SWITCH)).toHaveAttribute('aria-checked', 'true');
  });
});
