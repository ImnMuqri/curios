import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { helpGuide, publicGuide } from '@curios/core/help-guide';

const sections = publicGuide(helpGuide(), { prices: { MONTHLY: 4900, ANNUAL: 49000 }, freeLeads: 3, freeOrders: 3, cap: 200 });

class FakeApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

let chatOn = true;
let askReply: unknown = null;
const apiFetch = vi.fn(async (path: string, init?: RequestInit): Promise<unknown> => {
  if (path === '/help/guide') return { sections, chat: chatOn };
  if (path === '/help/ask') {
    if (askReply instanceof Error) throw askReply;
    return askReply;
  }
  if (path === '/help/topic') return { id: `topic-${(JSON.parse(init?.body as string) as { entryId: string }).entryId}` };
  if (path === '/help/support') return { email: 'lina@keklina.example' };
  return { status: 'saved' };
});
vi.mock('../../../lib/api.js', () => ({ apiFetch: (path: string, init?: RequestInit) => apiFetch(path, init), ApiError: FakeApiError }));
vi.mock('next/navigation', () => ({ usePathname: () => '/app/settings', useRouter: () => ({ push: vi.fn() }) }));

const { HelpPanel } = await import('./help-panel.js');

const navigate = vi.fn();
const onClose = vi.fn();
const show = () => render(<HelpPanel firstName="Lina" email="lina@keklina.example" onClose={onClose} navigate={navigate} />);
const bodyOf = (path: string) => JSON.parse((apiFetch.mock.calls.find(([p]) => p === path)?.[1]?.body as string | undefined) ?? '{}') as Record<string, unknown>;

async function asked(question: string) {
  fireEvent.change(screen.getByRole('textbox', { name: 'Ask about Curios' }), { target: { value: question } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
  });
}

beforeEach(() => {
  window.sessionStorage.clear();
  chatOn = true;
  askReply = { state: 'answer', id: 'q1', entryId: 'shop-vouchers', answer: 'Make a voucher in **Store**, on the Vouchers tab.', question: 'How do I give a discount?', open: '/app/store?tab=vouchers' };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('HelpPanel: start', () => {
  it('greets the owner, suggests four questions for the screen they are on, and offers every topic', async () => {
    show();
    expect(screen.getByRole('heading', { name: 'Hi Lina. What can I help with?' })).toBeInTheDocument();
    expect(await screen.findByText('People on Settings often ask')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /How do I change which emails I get\?/ })).toBeInTheDocument();
    expect(screen.getByText('Why isn’t my page on Google?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Browse all topics' })).toBeInTheDocument();
  });

  it('closes on Escape and from its close button', () => {
    show();
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Close help' }).at(-1)!);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe('HelpPanel: asking', () => {
  it('asks with the screen, shows the answer with its source and screen button, and takes Yes', async () => {
    show();
    await asked('how do i give a discount for raya?');

    expect(bodyOf('/help/ask')).toEqual({ question: 'how do i give a discount for raya?', screen: 'settings', history: [] });
    expect(screen.getByText('how do i give a discount for raya?')).toBeInTheDocument();
    expect(screen.getByText('Store', { selector: 'b' })).toBeInTheDocument();
    expect(screen.getByText('From the guide · How do I give a discount?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open Store' }));
    expect(navigate).toHaveBeenCalledWith('/app/store?tab=vouchers');

    fireEvent.click(screen.getByRole('button', { name: 'Yes, it helped' }));
    expect(screen.getByText('Glad that helped.')).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith('/help/q1/feedback', expect.objectContaining({ method: 'POST', body: JSON.stringify({ helped: true }) }));
  });

  it('opens the support card on No, and sends the question with a note', async () => {
    show();
    await asked('how do i give a discount?');
    fireEvent.click(screen.getByRole('button', { name: 'No, it didn’t help' }));

    expect(screen.getByText('Still stuck? Email support')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'or email support@curios.my' })).toHaveAttribute('href', 'mailto:support@curios.my');
    fireEvent.change(screen.getByRole('textbox', { name: 'Anything to add' }), { target: { value: 'For Raya only.' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send to support' }));
    });

    expect(bodyOf('/help/support')).toEqual({ id: 'q1', note: 'For Raya only.', screen: 'settings' });
    expect(screen.getByText('Sent to support')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('We’ll reply to lina@keklina.example by email.');
  });

  it('says plainly when it is not in the guide, with support straight away and no Yes/No', async () => {
    askReply = { state: 'unknown', id: 'q2', answer: 'That isn’t in the help guide, so I won’t guess. Our team can tell you for sure.' };
    show();
    await asked('Can I use my own domain?');

    expect(screen.getByText(/isn’t in the help guide/)).toBeInTheDocument();
    expect(screen.queryByText('Did this help?')).toBeNull();
    expect(screen.queryByText(/From the guide/)).toBeNull();
    expect(screen.getByText('Still stuck? Email support')).toBeInTheDocument();
  });

  it('sends the earlier turns with the next question', async () => {
    show();
    await asked('how do i give a discount?');
    apiFetch.mockClear();
    await asked('and for one item only?');
    expect(bodyOf('/help/ask').history).toEqual([
      { role: 'user', content: 'how do i give a discount?' },
      { role: 'assistant', content: 'Make a voucher in **Store**, on the Vouchers tab.' },
    ]);
  });

  it('rests and opens Topics when the chat cannot answer', async () => {
    askReply = { state: 'resting' };
    show();
    await asked('hi');
    expect(screen.getByRole('heading', { name: 'Help topics' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to the chat' }));
    expect(screen.getByText(/Help chat is resting/)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Ask about Curios' })).toBeDisabled();
  });

  it('starts resting while the admin has chat off', async () => {
    chatOn = false;
    show();
    expect(await screen.findByText(/Help chat is resting/)).toBeInTheDocument();
  });

  it('says what the limit says when there have been too many questions, and keeps the words', async () => {
    askReply = new FakeApiError(429, 'Too many help questions just now. Try again in 20 minutes, or browse the topics.');
    show();
    await asked('one more?');
    expect(screen.getByRole('alert')).toHaveTextContent('Too many help questions just now.');
    expect(screen.getByRole('textbox', { name: 'Ask about Curios' })).toHaveValue('one more?');
  });
});

describe('HelpPanel: topics', () => {
  it('lists the sections with their counts, opens one, and shows a picked question as an answer', async () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Browse all topics' }));
    const billing = await screen.findByRole('button', { name: /Billing and your plan/ });
    expect(billing).toHaveTextContent(`${sections.find((s) => s.title === 'Billing and your plan')!.entries.length} questions`);
    fireEvent.click(billing);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'How much is Business?' }));
    });

    expect(bodyOf('/help/topic')).toEqual({ entryId: 'bill-price', screen: 'settings' });
    expect(screen.getByText('RM49 a month, or RM490 a year (two months free). Personal pages are free.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Billing' })).toBeInTheDocument();
  });

  it('searches the guide without a model', async () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Browse all topics' }));
    await screen.findByRole('button', { name: /Billing and your plan/ });
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search the guide' }), { target: { value: 'dark mode' } });
    expect(screen.getByRole('button', { name: 'Is there a dark mode?' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search the guide' }), { target: { value: 'zzqx' } });
    expect(screen.getByText('Nothing in the guide matches that.')).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalledWith('/help/ask', expect.anything());
  });

  it('sends a note alone from "Can’t find it?", and needs one', async () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Browse all topics' }));
    fireEvent.click(screen.getByRole('button', { name: 'Email support' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send to support' }));
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Write what you need help with.');
    fireEvent.change(screen.getByRole('textbox', { name: 'What you need help with' }), { target: { value: 'Move my page to a new email' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send to support' }));
    });
    expect(bodyOf('/help/support')).toEqual({ note: 'Move my page to a new email', screen: 'settings' });
  });
});

describe('HelpPanel: the thread', () => {
  it('keeps the conversation when the panel closes and opens again in the same session', async () => {
    const first = show();
    await asked('how do i give a discount?');
    first.unmount();

    show();
    await waitFor(() => expect(screen.getByText('From the guide · How do I give a discount?')).toBeInTheDocument());
    expect(within(screen.getByRole('dialog')).queryByText('Hi Lina. What can I help with?')).toBeNull();
  });
});
