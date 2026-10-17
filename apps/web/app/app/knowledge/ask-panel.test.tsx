import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AskPanel } from './ask-panel.js';

function panel(overrides: Partial<Parameters<typeof AskPanel>[0]> = {}) {
  const props = {
    suggestions: ['Berapa kek coklat 2kg?', 'Ada delivery?'],
    onAsk: vi.fn().mockResolvedValue({ reply: 'Kek coklat 2kg RM170.', from: 'facts' as const }),
    ...overrides,
  };
  render(<AskPanel {...props} />);
  return props;
}

const log = () => screen.getByRole('log', { name: "Your page's answers" });

describe('AskPanel', () => {
  it('says what it is for before anything is asked', () => {
    panel();
    expect(within(log()).getByText(/the way a customer would/i)).toBeInTheDocument();
  });

  it('asks what is typed and shows the answer', async () => {
    const { onAsk } = panel();
    await userEvent.type(screen.getByRole('textbox', { name: 'Ask your page' }), 'Berapa 2kg?');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onAsk).toHaveBeenCalledWith('Berapa 2kg?', []);
    expect(await within(log()).findByText('Kek coklat 2kg RM170.')).toBeInTheDocument();
    expect(within(log()).getByText('Berapa 2kg?')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Ask your page' })).toHaveValue('');
  });

  it('asks a suggestion in one tap', async () => {
    const { onAsk } = panel();
    await userEvent.click(screen.getByRole('button', { name: 'Ada delivery?' }));
    expect(onAsk).toHaveBeenCalledWith('Ada delivery?', []);
  });

  it('sends the earlier turns with a follow-up', async () => {
    const { onAsk } = panel();
    await userEvent.click(screen.getByRole('button', { name: 'Berapa kek coklat 2kg?' }));
    await within(log()).findByText('Kek coklat 2kg RM170.');
    await userEvent.type(screen.getByRole('textbox', { name: 'Ask your page' }), 'Yang 1kg?');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onAsk).toHaveBeenLastCalledWith('Yang 1kg?', [
      { role: 'user', content: 'Berapa kek coklat 2kg?' },
      { role: 'assistant', content: 'Kek coklat 2kg RM170.' },
    ]);
  });

  it("names the owner's own answer when that is what it gave", async () => {
    panel({ onAsk: vi.fn().mockResolvedValue({ reply: 'Yes, all halal.', from: 'answer' }) });
    await userEvent.click(screen.getByRole('button', { name: 'Ada delivery?' }));
    expect(await within(log()).findByText('Your answer on Questions')).toBeInTheDocument();
  });

  it('puts the question back and says why when asking fails', async () => {
    panel({ onAsk: vi.fn().mockRejectedValue(new Error('Too many questions just now. Try again in 1 hour.')) });
    await userEvent.type(screen.getByRole('textbox', { name: 'Ask your page' }), 'Berapa 2kg?');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many questions just now.');
    expect(screen.getByRole('textbox', { name: 'Ask your page' })).toHaveValue('Berapa 2kg?');
    expect(within(log()).queryByText('Berapa 2kg?')).toBeNull();
  });

  it('sends nothing empty', async () => {
    const { onAsk } = panel();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    await userEvent.type(screen.getByRole('textbox', { name: 'Ask your page' }), '   {enter}');
    expect(onAsk).not.toHaveBeenCalled();
  });

  it('says when the reply is the month’s fixed one', async () => {
    panel({ onAsk: vi.fn().mockResolvedValue({ reply: 'We’ve answered a lot of questions this month.', from: 'limit' }) });
    await userEvent.click(screen.getByRole('button', { name: 'Ada delivery?' }));
    expect(await within(log()).findByText(/this month’s limit is reached/)).toBeInTheDocument();
  });
});
