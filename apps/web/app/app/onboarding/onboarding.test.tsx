import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../../lib/api.js';
import { OnboardingFlow, type FoundFact, type OnboardingActions } from './onboarding.js';

function actions(overrides: Partial<OnboardingActions> = {}): OnboardingActions {
  return {
    checkHandle: vi.fn(async () => 'available' as const),
    claim: vi.fn(async () => ({ pageId: 'p1' })),
    ingest: vi.fn(async () => ({ ingestionId: 'ing-1' })),
    fetchStatus: vi.fn(async () => ({ status: 'SUCCEEDED' as const, extractedCount: 2, progress: 100, error: null })),
    refresh: vi.fn(),
    navigate: vi.fn(),
    ...overrides,
  };
}

const facts: FoundFact[] = [
  { id: 'f1', category: 'PRICE', claim: 'Kek coklat 2kg is RM170', question: 'Berapa kek coklat 2kg?' },
  { id: 'f2', category: 'POLICY', claim: '2 days notice', question: null },
];

function flow(props: Partial<Parameters<typeof OnboardingFlow>[0]> = {}) {
  const a = props.actions ?? actions();
  const view = render(<OnboardingFlow page={null} facts={[]} monthlyPrice="RM49" freeLeads={3} freeOrders={3} pastedTextMax={20000} actions={a} {...props} />);
  return { a, ...view };
}

async function claimStep(handle = 'keklina', name = 'Kek Lina') {
  await userEvent.type(screen.getByLabelText('Your address'), handle);
  await userEvent.type(screen.getByLabelText('Name on the page'), name);
  // The check runs a moment after typing stops.
  await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled());
}

describe('OnboardingFlow', () => {
  it('checks the address as it is typed, and holds Continue until it is free and named', async () => {
    const { a } = flow();
    expect(screen.getByRole('heading', { name: 'Claim your page.' })).toBeInTheDocument();
    expect(screen.getByText('Step 1 of 4')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Your address'), 'Kek Lina');
    // Lowercased, spaces gone, as the board does.
    expect(screen.getByLabelText('Your address')).toHaveValue('keklina');
    await waitFor(() => expect(a.checkHandle).toHaveBeenLastCalledWith('keklina'));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Yours'));
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();

    await userEvent.type(screen.getByLabelText('Name on the page'), 'Kek Lina');
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
  });

  it('says when an address is taken, and suggests two', async () => {
    flow({ actions: actions({ checkHandle: vi.fn(async () => 'taken' as const) }) });
    await userEvent.type(screen.getByLabelText('Your address'), 'aisyah');

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Taken'));
    expect(screen.getByText('Someone has that one. Try aisyahmy or aisyah2.')).toBeInTheDocument();
  });

  it('quotes Business at the price, free leads and free orders in force, never typed in', async () => {
    flow({ monthlyPrice: 'RM59', freeLeads: 5, freeOrders: 2 });
    await claimStep();
    await userEvent.click(await screen.findByRole('button', { name: 'Continue' }));

    const business = screen.getByRole('radio', { name: /Business/ });
    expect(business).toHaveTextContent('RM59 a month · first 5 leads and 2 orders free');
    expect(business).toHaveTextContent('It answers customers, takes their numbers and runs your shop.');
    expect(business).toHaveTextContent('A shop paid by FPX, e-wallet, card or QR');
    expect(business).toHaveTextContent('FAQ pages Google can find');
    const personal = screen.getByRole('radio', { name: /Personal/ });
    expect(personal).toHaveTextContent('Free');
    expect(personal).toHaveTextContent('Hidden from Google unless you switch it on');
  });

  it('says the plan in the board words for the default settings, and a singular for one', async () => {
    const { unmount } = flow();
    await claimStep();
    await userEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    expect(screen.getByRole('radio', { name: /Business/ })).toHaveTextContent('RM49 a month · first 3 leads and 3 orders free');
    unmount();

    flow({ freeLeads: 1, freeOrders: 1 });
    await claimStep();
    await userEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    expect(screen.getByRole('radio', { name: /Business/ })).toHaveTextContent('first 1 lead and 1 order free');
  });

  it('claims with the mode chosen only when it reads a source, then reads it', async () => {
    const { a } = flow();
    await claimStep();
    await userEvent.click(await screen.findByRole('button', { name: 'Continue' }));

    expect(screen.getByRole('heading', { name: 'What is this page for?' })).toBeInTheDocument();
    // Neither is chosen for the owner, and Continue waits until one is.
    expect(screen.getByRole('radio', { name: /Business/ })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('radio', { name: /Personal/ })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    await userEvent.click(screen.getByRole('radio', { name: /Personal/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(screen.getByRole('heading', { name: 'Teach it about you.' })).toBeInTheDocument();
    expect(a.claim).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText('A link about you'), 'lina.example/about');
    await userEvent.click(screen.getByRole('button', { name: 'Read it' }));

    expect(a.claim).toHaveBeenCalledWith({ handle: 'keklina', displayName: 'Kek Lina', mode: 'PERSONAL' });
    expect(a.ingest).toHaveBeenCalledWith({ pageId: 'p1', sourceUrl: 'lina.example/about' });
  });

  it('shows what it found once reading finishes, and sends the owner to Review', async () => {
    const a = actions();
    const { rerender } = flow({ actions: a });
    await claimStep();
    await userEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    await userEvent.click(screen.getByRole('radio', { name: /Business/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await userEvent.type(screen.getByLabelText('Your website address'), 'keklina.example/menu');
    await userEvent.click(screen.getByRole('button', { name: 'Read it' }));

    expect(await screen.findByRole('heading', { name: 'Done reading.' })).toBeInTheDocument();
    expect(a.refresh).toHaveBeenCalled();

    // The refresh brings the facts it found.
    rerender(<OnboardingFlow page={null} facts={facts} monthlyPrice="RM49" freeLeads={3} freeOrders={3} pastedTextMax={20000} actions={a} />);
    // The card is headed by the source and its count, one row per fact with its kind.
    expect(screen.getByText('keklina.example/menu')).toBeInTheDocument();
    expect(screen.getByText('2 facts')).toBeInTheDocument();
    expect(screen.getByText('Kek coklat 2kg is RM170')).toBeInTheDocument();
    expect(screen.getByText('Price')).toBeInTheDocument();
    expect(screen.getByText('They are waiting in Review. Nothing goes live until you accept each one.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add another source' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Review them' })).toHaveAttribute('href', '/app/review');
  });

  it('turns a quiet read into a paste', async () => {
    flow({ page: { id: 'p1', handle: 'keklina', displayName: 'Kek Lina', mode: 'BUSINESS' }, actions: actions({ fetchStatus: vi.fn(async () => ({ status: 'SUCCEEDED' as const, extractedCount: 0, progress: 100, error: null })) }) });
    await userEvent.type(screen.getByLabelText('Your website address'), 'keklina.example');
    await userEvent.click(screen.getByRole('button', { name: 'Read it' }));

    expect(await screen.findByRole('heading', { name: 'That one was quiet.' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Paste text instead' }));
    expect(screen.getByLabelText('About your business')).toBeInTheDocument();
  });

  it('goes back to the address, saying why, when the claim is refused', async () => {
    const a = actions({ claim: vi.fn(async () => Promise.reject(new ApiError(409, 'HANDLE_TAKEN', 'That handle is taken. Pick another.'))) });
    flow({ actions: a });
    await claimStep();
    await userEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    await userEvent.click(screen.getByRole('radio', { name: /Business/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await userEvent.type(screen.getByLabelText('Your website address'), 'keklina.example');
    await userEvent.click(screen.getByRole('button', { name: 'Read it' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('That handle is taken. Pick another.');
    expect(screen.getByRole('heading', { name: 'Claim your page.' })).toBeInTheDocument();
    expect(a.ingest).not.toHaveBeenCalled();
  });

  it('starts an owner who has a page at the third step, with no way back to claim', () => {
    flow({ page: { id: 'p1', handle: 'keklina', displayName: 'Kek Lina', mode: 'BUSINESS' } });
    expect(screen.getByRole('heading', { name: 'Teach it about your business.' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
  });

  it('claims, then leaves for the dashboard, when the owner skips', async () => {
    const { a } = flow();
    await claimStep();
    await userEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    await userEvent.click(screen.getByRole('radio', { name: /Business/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await userEvent.click(screen.getByRole('button', { name: 'Skip for now' }));

    expect(a.claim).toHaveBeenCalled();
    expect(a.navigate).toHaveBeenCalledWith('/app/curios');
  });

  it('will not read a login-walled profile, and says to paste instead', async () => {
    flow({ page: { id: 'p1', handle: 'keklina', displayName: 'Kek Lina', mode: 'BUSINESS' } });
    await userEvent.type(screen.getByLabelText('Your website address'), 'instagram.com/keklina');

    expect(screen.getByText(/don’t let us read profiles/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Read it' })).toBeDisabled();
  });

  it('shows how far it has read, and asks for each fact as it is written, without listing them while it reads (owner answer 8)', async () => {
    // Two polls while reading (one fact, then two), then done.
    const polls = [
      { status: 'RUNNING' as const, extractedCount: 1, progress: 40, error: null },
      { status: 'RUNNING' as const, extractedCount: 2, progress: 80, error: null },
      { status: 'SUCCEEDED' as const, extractedCount: 2, progress: 100, error: null },
    ];
    const a = actions({ fetchStatus: vi.fn(async () => polls.shift() ?? { status: 'SUCCEEDED' as const, extractedCount: 2, progress: 100, error: null }) });
    const page = { id: 'p1', handle: 'keklina', displayName: 'Kek Lina', mode: 'BUSINESS' as const };
    const { rerender } = flow({ page, actions: a });
    await userEvent.type(screen.getByLabelText('Your website address'), 'keklina.example');
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await userEvent.click(screen.getByRole('button', { name: 'Read it' }));

      // The first poll: one fact in, so the server is asked for it, and the bar is at 40.
      await waitFor(() => expect(screen.getByRole('progressbar', { name: 'How far it has read' })).toHaveAttribute('aria-valuenow', '40'));
      expect(a.refresh).toHaveBeenCalledTimes(1);
      rerender(<OnboardingFlow page={page} facts={facts.slice(0, 1)} monthlyPrice="RM49" freeLeads={3} freeOrders={3} pastedTextMax={20000} actions={a} />);
      expect(screen.getByRole('heading', { name: 'Reading it now…' })).toBeInTheDocument();
      expect(screen.queryByText('Kek coklat 2kg is RM170')).toBeNull();

      // The next: a second fact, asked for again.
      await vi.advanceTimersByTimeAsync(2000);
      await waitFor(() => expect(a.refresh).toHaveBeenCalledTimes(2));
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('OnboardingFlow, from the More board', () => {
  const owned = { id: 'p1', handle: 'keklina', displayName: 'Kek Lina', mode: 'BUSINESS' as const };

  it('is one centred column with no side panel, under a top bar with the four bars and Sign out', () => {
    const { container } = flow();
    expect(container.querySelector('aside')).toBeNull();
    expect(container.querySelector('[data-onboarding-panel]')).toBeNull();
    expect(screen.getByText('Step 1 of 4')).toBeInTheDocument();
    expect(container.querySelectorAll('header i')).toHaveLength(4);
    expect(container.querySelectorAll('header i[data-on]')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(screen.getByText('Pick your address. You can change how it looks later, not the address.')).toBeInTheDocument();
  });

  it('has Peek over the address pill, and over the source on the third step', () => {
    const { container, unmount } = flow();
    expect(container.querySelector('[data-auth-peek]')).not.toBeNull();
    unmount();
    const third = flow({ page: owned });
    expect(third.container.querySelector('[data-auth-peek]')).not.toBeNull();
  });

  it('draws the third step as a segmented A link / Paste text / A file, with "Read it" and "Skip for now", and Back until the page is claimed', () => {
    flow();
    // Not yet claimed, and still no Back on step 3: Skip for now is the way out.
    return (async () => {
      await claimStep();
      await userEvent.click(await screen.findByRole('button', { name: 'Continue' }));
      await userEvent.click(screen.getByRole('radio', { name: /Business/ }));
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }));

      const ways = within(screen.getByRole('group', { name: 'How to add it' }));
      expect(ways.getByRole('button', { name: 'A link' })).toHaveAttribute('aria-pressed', 'true');
      expect(ways.getByRole('button', { name: 'Paste text' })).toBeInTheDocument();
      expect(ways.getByRole('button', { name: 'A file' })).toBeInTheDocument();
      expect(screen.getByLabelText('Your website address')).toHaveAttribute('placeholder', 'your-site.com');
      expect(screen.getByRole('button', { name: 'Read it' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Skip for now' })).toBeInTheDocument();
      // Not claimed yet: Back stays, so a mis-clicked mode can be undone.
      expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();

      await userEvent.click(ways.getByRole('button', { name: 'Paste text' }));
      expect(screen.getByLabelText('About your business')).toBeInTheDocument();
      await userEvent.click(ways.getByRole('button', { name: 'A file' }));
      expect(screen.getByLabelText('A file to read')).toBeInTheDocument();
    })();
  });

  it('keeps Back on the mode step, where the board draws it', async () => {
    flow();
    await claimStep();
    await userEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('heading', { name: 'Claim your page.' })).toBeInTheDocument();
  });

  it('lists what it found in a card headed by the source, "N facts", and a kind tag on each row', async () => {
    const a = actions();
    const { rerender } = flow({ page: owned, actions: a });
    await userEvent.type(screen.getByLabelText('Your website address'), 'keklina.example/menu');
    await userEvent.click(screen.getByRole('button', { name: 'Read it' }));
    await screen.findByRole('heading', { name: 'Done reading.' });
    rerender(<OnboardingFlow page={owned} facts={facts} monthlyPrice="RM49" freeLeads={3} freeOrders={3} pastedTextMax={20000} actions={a} />);

    expect(screen.getByText('Here is what it picked out.')).toBeInTheDocument();
    expect(screen.getByText('2 facts')).toBeInTheDocument();
    expect(screen.getByText('Price')).toBeInTheDocument();
    expect(screen.getByText('Policy')).toBeInTheDocument();
    expect(screen.getByText('Kek coklat 2kg is RM170')).toBeInTheDocument();
    expect(screen.getByText('2 days notice')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Review them' })).toHaveAttribute('href', '/app/review');
  });

  it('says "1 fact" for one', async () => {
    const a = actions({ fetchStatus: vi.fn(async () => ({ status: 'SUCCEEDED' as const, extractedCount: 1, progress: 100, error: null })) });
    flow({ page: owned, actions: a, facts: facts.slice(0, 1) });
    await userEvent.type(screen.getByLabelText('Your website address'), 'keklina.example');
    await userEvent.click(screen.getByRole('button', { name: 'Read it' }));
    expect(await screen.findByText('1 fact')).toBeInTheDocument();
  });

  it('keeps the failed read, offering another source or skipping', async () => {
    flow({
      page: owned,
      actions: actions({ fetchStatus: vi.fn(async () => ({ status: 'FAILED' as const, extractedCount: 0, progress: 0, error: 'We could not open that page.' })) }),
    });
    await userEvent.type(screen.getByLabelText('Your website address'), 'keklina.example');
    await userEvent.click(screen.getByRole('button', { name: 'Read it' }));

    expect(await screen.findByRole('heading', { name: 'That didn’t work.' })).toBeInTheDocument();
    expect(screen.getByText('We could not open that page.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try a different source' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Skip for now' })).toHaveAttribute('href', '/app/curios');
  });

  it('keeps the quiet read and the reading state in the board style', async () => {
    const never = () => new Promise<never>(() => {});
    flow({ page: owned, actions: actions({ fetchStatus: vi.fn(never) }) });
    await userEvent.type(screen.getByLabelText('Your website address'), 'keklina.example');
    await userEvent.click(screen.getByRole('button', { name: 'Read it' }));
    expect(await screen.findByRole('heading', { name: 'Reading it now…' })).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'How far it has read' })).toBeInTheDocument();
    expect(screen.getByText('keklina.example')).toBeInTheDocument();
  });
});

describe('reduced motion', () => {
  it('stills the entrance, the scan and the bar', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const css = readFileSync(join(import.meta.dirname, 'onboarding.module.css'), 'utf8');
    const block = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(block).toMatch(/\.body,\s*\.rl,\s*\.res\s*\{\s*animation: none;/);
    expect(block).toMatch(/\.pbar i\s*\{\s*transition: none;/);
    const sys = readFileSync(join(import.meta.dirname, '..', '..', '_system', 'system.module.css'), 'utf8');
    expect(sys.slice(sys.indexOf('@media (prefers-reduced-motion: reduce)'))).toMatch(/\.sb\s*\{\s*animation: none;/);
  });
});
