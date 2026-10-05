import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../../lib/api.js';
import { ProfileEditor } from './profile-editor.js';

/** ProfileEditor's fields are controlled; a real caller (MyCuriosEditor) keeps
 * the typed value in state and feeds it back through `onChange`, which is
 * what lets a keystroke actually accumulate rather than being reset on every
 * render. This stands in for that caller so the test types like a person. */
function Controlled({
  save,
  uploadsEnabled = false,
  avatarUrl = null,
  onAvatar = () => undefined,
  uploadAvatar = async () => null,
  removeAvatar = async () => undefined,
}: {
  save: (patch: { displayName?: string; bio?: string | null }) => Promise<unknown>;
  uploadsEnabled?: boolean;
  avatarUrl?: string | null;
  onAvatar?: (url: string | null) => void;
  uploadAvatar?: (file: File) => Promise<string | null>;
  removeAvatar?: () => Promise<void>;
}) {
  const [state, setState] = useState({ displayName: 'Iman', bio: null as string | null });
  return (
    <ProfileEditor
      {...state}
      onChange={(change) => setState((s) => ({ ...s, ...change }))}
      save={save}
      uploadsEnabled={uploadsEnabled}
      avatarUrl={avatarUrl}
      onAvatar={onAvatar}
      uploadAvatar={uploadAvatar}
      removeAvatar={removeAvatar}
    />
  );
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

  // Fix round 2, Minor #2: an ApiError carries its own reason (the
  // empty-name or bio-too-long message, here), and SaveState must show that
  // instead of always the same generic sentence.
  it("shows the ApiError's own message instead of a generic one", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const save = vi.fn(async () => { throw new ApiError(400, 'DISPLAY_NAME_INVALID', 'Give the page a name, up to 80 characters.'); });
    render(<Controlled save={save} />);

    const name = screen.getByLabelText('Display name');
    await userEvent.type(name, '!', { delay: null });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });

    expect(screen.getByRole('alert')).toHaveTextContent('Give the page a name, up to 80 characters.');
    vi.useRealTimers();
  });

  // Fix round 2, Minor #2: a 4xx is a validation failure -- sending the same
  // rejected value again cannot succeed, so Retry must not be offered for one.
  it('offers no Retry for a 4xx, because sending the same value again cannot fix it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const save = vi.fn(async () => { throw new ApiError(400, 'BIO_TOO_LONG', 'That bio is too long.'); });
    render(<Controlled save={save} />);

    const bio = screen.getByLabelText('Bio');
    await userEvent.type(bio, 'x'.repeat(161), { delay: null });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });

    expect(screen.getByRole('alert')).toHaveTextContent('That bio is too long.');
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    vi.useRealTimers();
  });

  // A 5xx is not a validation failure -- retrying might actually work, so
  // Retry must still be offered for one, alongside the server's own message.
  it('still offers Retry for a 5xx, with the server\'s own message', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const save = vi.fn(async () => { throw new ApiError(500, 'INTERNAL_ERROR', 'Something failed. Try again.'); });
    render(<Controlled save={save} />);

    const name = screen.getByLabelText('Display name');
    await userEvent.type(name, '!', { delay: null });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });

    expect(screen.getByRole('alert')).toHaveTextContent('Something failed. Try again.');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    vi.useRealTimers();
  });

  // A failure with no ApiError attached (a dropped connection, say) still
  // gets the generic sentence and its Retry -- only a known 4xx is refused
  // one, never a failure this code cannot classify at all.
  it('keeps the generic message and Retry for a plain Error', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const save = vi.fn(async () => { throw new Error('offline'); });
    render(<Controlled save={save} />);

    const name = screen.getByLabelText('Display name');
    await userEvent.type(name, '!', { delay: null });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });

    expect(screen.getByRole('alert')).toHaveTextContent('That did not save.');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    vi.useRealTimers();
  });
});

const base = { displayName: 'Iman', bio: null, onChange: vi.fn(), save: vi.fn(async () => undefined), avatarUrl: null, onAvatar: vi.fn(), removeAvatar: vi.fn(async () => undefined) };

describe('ProfileEditor picture', () => {
  it('shows the upload disabled, with the reason, when storage is off', () => {
    render(<ProfileEditor {...base} uploadsEnabled={false} uploadAvatar={vi.fn()} />);
    expect(screen.getByLabelText('Upload a picture')).toBeDisabled();
    expect(screen.getByText(/switched off here/i)).toBeInTheDocument();
  });

  it('uploads a chosen file and shows the new picture', async () => {
    const onAvatar = vi.fn();
    const uploadAvatar = vi.fn(async () => 'https://cdn.example/a.webp');
    render(<ProfileEditor {...base} onAvatar={onAvatar} uploadsEnabled uploadAvatar={uploadAvatar} />);

    await userEvent.upload(screen.getByLabelText('Upload a picture'), new File(['x'], 'me.png', { type: 'image/png' }));

    expect(uploadAvatar).toHaveBeenCalled();
    expect(onAvatar).toHaveBeenCalledWith('https://cdn.example/a.webp');
  });

  it('keeps the old picture and says why when an upload fails', async () => {
    const onAvatar = vi.fn();
    const uploadAvatar = vi.fn(async () => { throw new Error('That picture could not be used.'); });
    render(<ProfileEditor {...base} avatarUrl="https://cdn.example/old.webp" onAvatar={onAvatar} uploadsEnabled uploadAvatar={uploadAvatar} />);

    await userEvent.upload(screen.getByLabelText('Upload a picture'), new File(['x'], 'me.png', { type: 'image/png' }));

    expect(onAvatar).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/could not be used/i);
  });

  it('offers no Remove picture button when there is no picture', () => {
    render(<ProfileEditor {...base} uploadsEnabled uploadAvatar={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Remove picture' })).toBeNull();
  });

  it('removes the picture when Remove picture is clicked', async () => {
    const removeAvatar = vi.fn(async () => undefined);
    render(<ProfileEditor {...base} avatarUrl="https://cdn.example/old.webp" uploadsEnabled uploadAvatar={vi.fn()} removeAvatar={removeAvatar} />);

    await userEvent.click(screen.getByRole('button', { name: 'Remove picture' }));

    expect(removeAvatar).toHaveBeenCalled();
  });

  it('says why when removing the picture fails', async () => {
    const removeAvatar = vi.fn(async () => { throw new Error('offline'); });
    render(<ProfileEditor {...base} avatarUrl="https://cdn.example/old.webp" uploadsEnabled uploadAvatar={vi.fn()} removeAvatar={removeAvatar} />);

    await userEvent.click(screen.getByRole('button', { name: 'Remove picture' }));

    expect(screen.getByRole('alert')).toHaveTextContent(/did not save/i);
  });

  // Fix round 2, Minor #3: the Avatar behaviour (apps/web/app/_bento/Avatar.tsx)
  // -- a picture that fails to load disappears rather than showing a broken
  // image icon, so the placeholder (or, once storage answers, just the name)
  // stands in its place instead.
  it('hides the thumbnail if it fails to load, showing the placeholder instead', () => {
    // Not `getByRole('img')`: this thumbnail's `alt=""` is deliberately
    // decorative (the name beside it already says who it is), which gives it
    // an implicit role of `presentation`, not `img` -- a container query is
    // what a sighted person's "is the picture still there" actually is here.
    const { container } = render(<ProfileEditor {...base} avatarUrl="https://cdn.example/old.webp" uploadsEnabled uploadAvatar={vi.fn()} />);
    const img = container.querySelector('img');
    expect(img).not.toBeNull();

    fireEvent.error(img as HTMLImageElement);

    expect(container.querySelector('img')).toBeNull();
  });
});
