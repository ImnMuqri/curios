import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProfileEditor } from './profile-editor.js';

/** ProfileEditor's fields are controlled; a real caller (MyCuriosEditor) keeps
 * the typed value in state and feeds it back through `onChange`, which is
 * what lets a keystroke actually accumulate rather than being reset on every
 * render. This stands in for that caller so the test types like a person. */
function Controlled({ save }: { save: (patch: { displayName?: string; bio?: string | null }) => Promise<unknown> }) {
  const [state, setState] = useState({ displayName: 'Iman', bio: null as string | null });
  return <ProfileEditor {...state} onChange={(change) => setState((s) => ({ ...s, ...change }))} save={save} />;
}

describe('ProfileEditor', () => {
  it('autosaves the bio after typing stops', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const save = vi.fn(async () => undefined);
    render(<Controlled save={save} />);

    const bio = screen.getByLabelText('Bio');
    await userEvent.type(bio, 'Hello', { delay: null });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });

    expect(save).toHaveBeenLastCalledWith({ bio: 'Hello' });
    vi.useRealTimers();
  });

  // The other half of profile-editor.tsx's SaveState wiring: a failed save
  // must offer Retry, and Retry must send the request again.
  it('offers Retry and saves again when the profile fails to save', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const save = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined);
    render(<Controlled save={save} />);

    const name = screen.getByLabelText('Display name');
    await userEvent.type(name, '!', { delay: null });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });

    const retry = screen.getByRole('button', { name: 'Retry' });
    await userEvent.click(retry, { delay: null });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    expect(save).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    vi.useRealTimers();
  });
});
