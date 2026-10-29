import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

  // The Knowledge board's empty chat: Peek whistling, "Nothing asked yet", gone once asked.
  it('shows Peek whistling until something is asked', async () => {
    panel();
    expect(within(log()).getByText('Nothing asked yet')).toBeInTheDocument();
    expect(log().querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Ada delivery?' }));
    expect(await within(log()).findByText('Kek coklat 2kg RM170.')).toBeInTheDocument();
    expect(within(log()).queryByText('Nothing asked yet')).toBeNull();
  });

  // Peek holds still for anyone who asked their device for less motion.
  it('stops Peek’s bob and notes under reduced motion', () => {
    const css = readFileSync(join(import.meta.dirname, 'knowledge.module.css'), 'utf8').replace(/\r/g, '');
    const reduced = css.slice(css.lastIndexOf('@media (prefers-reduced-motion: reduce)'));
    for (const name of ['.pwBob', '.pwNote1', '.pwNote2']) expect(reduced).toContain(name);
    expect(reduced).toMatch(/animation: none/);
  });

  // Dashboard v2: a normal AI chat on the dashboard's panel, not an island of the page's colours.
  it('draws the chat as a dashboard chat, not in the page’s colours', () => {
    panel();
    expect(log()).not.toHaveAttribute('data-island');
    expect(screen.getByRole('complementary', { name: 'Try your page' })).not.toHaveAttribute('data-on-accent');
    const css = readFileSync(join(import.meta.dirname, 'knowledge.module.css'), 'utf8').replace(/\r/g, '');
    const body = /\n\.tchat \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(body).toMatch(/background: var\(--chat\);/);
    expect(body).toMatch(/border-radius: 10px;/);
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

  it('shows the answer as plain text under "{Name}’s page"', async () => {
    panel({ pageName: 'Kek Lina' });
    await userEvent.click(screen.getByRole('button', { name: 'Berapa kek coklat 2kg?' }));
    const answer = await within(log()).findByText('Kek coklat 2kg RM170.');
    expect(answer.previousElementSibling).toHaveTextContent('Kek Lina’s page');
    expect(within(log()).getByText('Berapa kek coklat 2kg?').closest('[class]')).not.toBe(answer);
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

  it('names where the facts it used came from', async () => {
    panel({ onAsk: vi.fn().mockResolvedValue({ reply: 'Kek coklat 2kg RM170.', from: 'facts', sources: ['keklina.example/menu', 'A fact you added'] }) });
    await userEvent.click(screen.getByRole('button', { name: 'Berapa kek coklat 2kg?' }));
    expect(await within(log()).findByText('keklina.example/menu · A fact you added')).toBeInTheDocument();
  });

  it('names nothing when no fact could be named', async () => {
    panel();
    await userEvent.click(screen.getByRole('button', { name: 'Berapa kek coklat 2kg?' }));
    await within(log()).findByText('Kek coklat 2kg RM170.');
    // No "from" line: its tick is the only one in the log (Peek's eyes beside the reply are not it).
    expect(log().querySelector('path[d="M5 12.5l4.5 4.5L19 7.5"]')).toBeNull();
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

  it('says when chat is paused across Curios, and that it is not the monthly limit', async () => {
    panel({ onAsk: vi.fn().mockResolvedValue({ reply: 'We’ve answered a lot of questions this month.', from: 'off' }) });
    await userEvent.click(screen.getByRole('button', { name: 'Ada delivery?' }));
    expect(
      await within(log()).findByText('Chat is paused across Curios for a moment, so your page gives the short fixed reply. It’s not your monthly limit.'),
    ).toBeInTheDocument();
    expect(within(log()).queryByText(/this month’s limit is reached/)).toBeNull();
  });
});
