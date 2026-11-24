import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NotifyForm } from './notify-emails.js';

const LEADS = { name: 'Email me when someone leaves their number' };
const ORDERS = { name: 'Email me when a new order comes in' };
const RECEIPTS = { name: 'Email me when a receipt is uploaded' };

const QUESTIONS = { name: 'Email me when a question is asked 3 times' };
const PLAN = { name: 'Email me when my plan is ending' };

const all = { leads: true, orders: true, receipts: true, questions: false, planEnding: true };

describe('NotifyForm', () => {
  it('lists the board’s emails, order and receipt first, a question asked 3 times, the plan ending last', () => {
    render(<NotifyForm on={all} onChange={vi.fn()} />);

    expect(screen.getAllByRole('switch').map((s) => s.getAttribute('aria-label'))).toEqual([ORDERS.name, RECEIPTS.name, LEADS.name, QUESTIONS.name, PLAN.name]);
    expect(screen.getByText('A new order')).toBeInTheDocument();
    expect(screen.getByText('With the total, so you can check the receipt.')).toBeInTheDocument();
    expect(screen.getByText('A receipt is uploaded')).toBeInTheDocument();
    expect(screen.getByText('So you can mark it paid.')).toBeInTheDocument();
  });

  it('turns the lead email off, and says leads still wait in Leads', async () => {
    const onChange = vi.fn(async () => undefined);
    render(<NotifyForm on={all} onChange={onChange} />);

    await userEvent.click(screen.getByRole('switch', LEADS));

    expect(onChange).toHaveBeenCalledWith({ leads: false });
    expect(screen.getByRole('switch', LEADS)).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText('Off. New leads still wait in Leads.')).toBeInTheDocument();
  });

  it('turns the order email off on its own, and says orders still wait in Orders', async () => {
    const onChange = vi.fn(async () => undefined);
    render(<NotifyForm on={all} onChange={onChange} />);

    await userEvent.click(screen.getByRole('switch', ORDERS));

    expect(onChange).toHaveBeenCalledWith({ orders: false });
    expect(screen.getByRole('switch', ORDERS)).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('switch', RECEIPTS)).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('Off. New orders still wait in Orders.')).toBeInTheDocument();
  });

  it('turns the receipt email on from off', async () => {
    const onChange = vi.fn(async () => undefined);
    render(<NotifyForm on={{ ...all, receipts: false }} onChange={onChange} />);
    expect(screen.getByText('Off. Receipts still show on the order in Orders.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('switch', RECEIPTS));

    expect(onChange).toHaveBeenCalledWith({ receipts: true });
    expect(screen.getByRole('switch', RECEIPTS)).toHaveAttribute('aria-checked', 'true');
  });

  it('puts the switch back, and says why under its own row, when the change could not be saved', async () => {
    render(<NotifyForm on={all} onChange={vi.fn(async () => Promise.reject(new Error('Something failed on our side. Try again.')))} />);

    await userEvent.click(screen.getByRole('switch', ORDERS));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Something failed');
    expect(within(alert.parentElement!).getByRole('switch', ORDERS)).toBeInTheDocument();
    expect(screen.getByRole('switch', ORDERS)).toHaveAttribute('aria-checked', 'true');
  });

  it('starts the question email off, as the board draws it, and turns it on', async () => {
    const onChange = vi.fn(async () => undefined);
    render(<NotifyForm on={all} onChange={onChange} />);

    expect(screen.getByRole('switch', QUESTIONS)).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText('Off. Questions that need you still wait in Questions.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('switch', QUESTIONS));

    expect(onChange).toHaveBeenCalledWith({ questions: true });
    expect(screen.getByRole('switch', QUESTIONS)).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('A sign it needs your answer.')).toBeInTheDocument();
  });

  it('lets the plan-ending email be turned off, on its own', async () => {
    const onChange = vi.fn(async () => undefined);
    render(<NotifyForm on={all} onChange={onChange} />);

    const plan = screen.getByRole('switch', PLAN);
    expect(plan).toHaveAttribute('aria-checked', 'true');
    expect(plan).toBeEnabled();
    expect(screen.getByText('Your plan is ending')).toBeInTheDocument();
    expect(screen.getByText('3 days before, and on the day.')).toBeInTheDocument();

    await userEvent.click(plan);

    expect(onChange).toHaveBeenCalledWith({ planEnding: false });
    expect(plan).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('switch', ORDERS)).toHaveAttribute('aria-checked', 'true');
  });
});
