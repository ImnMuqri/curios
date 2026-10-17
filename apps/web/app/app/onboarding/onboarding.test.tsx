import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../../lib/api.js';
import { OnboardingFlow, type FoundFact, type OnboardingActions } from './onboarding.js';

function actions(overrides: Partial<OnboardingActions> = {}): OnboardingActions {
  return {
    checkHandle: vi.fn(async () => 'available' as const),
    claim: vi.fn(async () => ({ pageId: 'p1' })),
    ingest: vi.fn(async () => ({ ingestionId: 'ing-1' })),
    fetchStatus: vi.fn(async () => ({ status: 'SUCCEEDED' as const, extractedCount: 2, error: null })),
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
  const view = render(<OnboardingFlow page={null} facts={[]} monthlyPrice="RM49" pastedTextMax={20000} actions={a} {...props} />);
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
    expect(screen.getByRole('heading', { name: 'Claim your page' })).toBeInTheDocument();
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

  it('claims with the mode chosen only when it reads a source, then reads it', async () => {
    const { a } = flow();
    await claimStep();
    await userEvent.click(await screen.findByRole('button', { name: 'Continue' }));

    expect(screen.getByRole('heading', { name: 'What is this page for?' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Business/ })).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(screen.getByRole('radio', { name: /Personal/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(screen.getByRole('heading', { name: 'Teach it about you' })).toBeInTheDocument();
    expect(a.claim).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText('A link about you'), 'lina.example/about');
    await userEvent.click(screen.getByRole('button', { name: 'Read this link' }));

    expect(a.claim).toHaveBeenCalledWith({ handle: 'keklina', displayName: 'Kek Lina', mode: 'PERSONAL' });
    expect(a.ingest).toHaveBeenCalledWith({ pageId: 'p1', sourceUrl: 'lina.example/about' });
  });

  it('shows what it found once reading finishes, and sends the owner to Review', async () => {
    const a = actions();
    const { rerender } = flow({ actions: a });
    await claimStep();
    await userEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await userEvent.type(screen.getByLabelText('Your website address'), 'keklina.example/menu');
    await userEvent.click(screen.getByRole('button', { name: 'Read my website' }));

    expect(await screen.findByRole('heading', { name: 'Done reading' })).toBeInTheDocument();
    expect(a.refresh).toHaveBeenCalled();

    // The refresh brings the facts it found.
    rerender(<OnboardingFlow page={null} facts={facts} monthlyPrice="RM49" pastedTextMax={20000} actions={a} />);
    expect(screen.getByText('Found 2 facts')).toBeInTheDocument();
    expect(screen.getAllByText('Kek coklat 2kg is RM170').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'Review them' })).toHaveAttribute('href', '/app/review');
  });

  it('turns a quiet read into a paste', async () => {
    flow({ page: { id: 'p1', handle: 'keklina', displayName: 'Kek Lina', mode: 'BUSINESS' }, actions: actions({ fetchStatus: vi.fn(async () => ({ status: 'SUCCEEDED' as const, extractedCount: 0, error: null })) }) });
    await userEvent.type(screen.getByLabelText('Your website address'), 'keklina.example');
    await userEvent.click(screen.getByRole('button', { name: 'Read my website' }));

    expect(await screen.findByRole('heading', { name: 'That one was quiet' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Paste text instead' }));
    expect(screen.getByLabelText('About your business')).toBeInTheDocument();
  });

  it('goes back to the address, saying why, when the claim is refused', async () => {
    const a = actions({ claim: vi.fn(async () => Promise.reject(new ApiError(409, 'HANDLE_TAKEN', 'That handle is taken. Pick another.'))) });
    flow({ actions: a });
    await claimStep();
    await userEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await userEvent.type(screen.getByLabelText('Your website address'), 'keklina.example');
    await userEvent.click(screen.getByRole('button', { name: 'Read my website' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('That handle is taken. Pick another.');
    expect(screen.getByRole('heading', { name: 'Claim your page' })).toBeInTheDocument();
    expect(a.ingest).not.toHaveBeenCalled();
  });

  it('starts an owner who has a page at the third step, with no way back to claim', () => {
    flow({ page: { id: 'p1', handle: 'keklina', displayName: 'Kek Lina', mode: 'BUSINESS' } });
    expect(screen.getByRole('heading', { name: 'Teach it about your business' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
  });

  it('claims, then leaves for the dashboard, when the owner skips', async () => {
    const { a } = flow();
    await claimStep();
    await userEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await userEvent.click(screen.getByRole('button', { name: 'Skip for now' }));

    expect(a.claim).toHaveBeenCalled();
    expect(a.navigate).toHaveBeenCalledWith('/app/curios');
  });

  it('will not read a login-walled profile, and says to paste instead', async () => {
    flow({ page: { id: 'p1', handle: 'keklina', displayName: 'Kek Lina', mode: 'BUSINESS' } });
    await userEvent.type(screen.getByLabelText('Your website address'), 'instagram.com/keklina');

    expect(screen.getByText(/don’t let us read profiles/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Read my website' })).toBeDisabled();
  });
});
