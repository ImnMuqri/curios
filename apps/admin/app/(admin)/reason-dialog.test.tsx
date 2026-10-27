import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReasonDialog } from './reason-dialog.js';

function open(extra: { typeToConfirm?: string; ownerSees?: boolean; onConfirm?: (r: string) => Promise<void> } = {}) {
  const onConfirm = extra.onConfirm ?? vi.fn().mockResolvedValue(undefined);
  const onClose = vi.fn();
  render(
    <ReasonDialog
      title="Pause the queue?"
      text="Sources wait until it is back on."
      confirmLabel="Pause"
      placeholder="E.g. Provider outage"
      typeToConfirm={extra.typeToConfirm}
      ownerSees={extra.ownerSees}
      onConfirm={onConfirm}
      onClose={onClose}
    />,
  );
  return { onConfirm, onClose };
}

const reasonBox = () => screen.getByLabelText('Reason, for the audit log');
const confirmBtn = () => screen.getByRole('button', { name: 'Pause' });

describe('ReasonDialog', () => {
  it('keeps confirm disabled on an empty or whitespace reason, enables it once typed', async () => {
    open();
    expect(screen.getByRole('dialog', { name: 'Pause the queue?' })).toBeInTheDocument();
    expect(reasonBox()).toHaveAttribute('placeholder', 'E.g. Provider outage');
    expect(confirmBtn()).toBeDisabled();
    await userEvent.type(reasonBox(), '   ');
    expect(confirmBtn()).toBeDisabled();
    await userEvent.type(reasonBox(), 'x');
    expect(confirmBtn()).toBeEnabled();
  });

  it('gates on an exact typeToConfirm match', async () => {
    open({ typeToConfirm: 'keklina' });
    await userEvent.type(reasonBox(), 'Because');
    expect(confirmBtn()).toBeDisabled();
    const typed = screen.getByLabelText('Type keklina to confirm');
    await userEvent.type(typed, 'keklinA');
    expect(confirmBtn()).toBeDisabled();
    await userEvent.clear(typed);
    await userEvent.type(typed, 'keklina');
    expect(confirmBtn()).toBeEnabled();
  });

  it('hands onConfirm the trimmed reason', async () => {
    const { onConfirm } = open();
    await userEvent.type(reasonBox(), '  Provider outage ');
    await userEvent.click(confirmBtn());
    expect(onConfirm).toHaveBeenCalledWith('Provider outage');
  });

  it('shows the message of a rejected onConfirm and stays open', async () => {
    const { onClose } = open({ onConfirm: vi.fn().mockRejectedValue(new Error('Already paused.')) });
    await userEvent.type(reasonBox(), 'Why');
    await userEvent.click(confirmBtn());
    expect(await screen.findByRole('alert')).toHaveTextContent('Already paused.');
    expect(onClose).not.toHaveBeenCalled();
    expect(confirmBtn()).toBeEnabled();
  });

  it('shows the owner note only when asked', () => {
    open({ ownerSees: true });
    expect(screen.getByText('The owner sees this.')).toBeInTheDocument();
  });
});
